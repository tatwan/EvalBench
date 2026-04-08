import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
import asyncio
import json
from collections import defaultdict

from backend.database import get_db
from backend.scoring.stats import calculate_confidence_interval
from backend.services import storage
from backend.services.eval_runner import run_eval, stream_progress
from backend.schemas import EvalRunOut, EvalRunCreate, EvalRunConfig

router = APIRouter(prefix="/api/eval-runs", tags=["eval-runs"])


@router.get("", response_model=list[EvalRunOut])
def list_eval_runs(db: Session = Depends(get_db)):
    return storage.get_all_eval_runs(db)


@router.post("", response_model=EvalRunOut, status_code=201)
async def create_eval_run(
    payload: EvalRunCreate,
    db: Session = Depends(get_db),
):
    if not payload.model_ids and not payload.cloud_models:
        raise HTTPException(status_code=400, detail="At least one local or cloud model must be selected")

    dataset_item_count: int | None = None
    if payload.dataset_id is not None:
        dataset = storage.get_dataset(db, payload.dataset_id)
        if not dataset:
            raise HTTPException(status_code=400, detail="Selected dataset does not exist")
        dataset_items = storage.get_dataset_items(db, payload.dataset_id)
        dataset_item_count = len(dataset_items)
        if dataset_item_count == 0:
            raise HTTPException(status_code=400, detail="Selected dataset contains no items")

    config = EvalRunConfig(
        model_ids=payload.model_ids,
        cloud_models=payload.cloud_models,
        task_type=payload.task_type,
        dataset_id=payload.dataset_id,
        dataset_item_count=dataset_item_count,
        benchmark_keys=payload.benchmark_keys or [payload.task_type],
    ).model_dump(by_alias=True, exclude_none=True)
    run = storage.create_eval_run(db, config)
    # Launch the runner as an independent task so long-running evals do not
    # rely on FastAPI BackgroundTasks semantics.
    asyncio.create_task(run_eval(run.id))
    return run


@router.get("/{run_id}", response_model=EvalRunOut)
def get_eval_run(run_id: int, db: Session = Depends(get_db)):
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return run


@router.get("/{run_id}/export")
def export_eval_run(
    run_id: int,
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    results = storage.get_eval_results(db, run_id)

    run_data = {
        "run_id": run.id,
        "status": run.status,
        "config": run.config_json,
        "created_at": run.timestamp.isoformat() if run.timestamp else None,
        "results": [
            {
                "model_id": r.model_id,
                "item_id": r.item_id,
                "metric_name": r.metric_name,
                "score": r.score,
                "raw_output": r.raw_output,
                "error": bool(r.error),
            }
            for r in results
        ],
    }

    if format == "json":
        return JSONResponse(
            content=run_data,
            headers={"Content-Disposition": f"attachment; filename=eval_run_{run_id}.json"},
        )

    output = io.StringIO()
    fieldnames = ["run_id", "model_id", "item_id", "metric_name", "score", "raw_output", "error"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for r in run_data["results"]:
        writer.writerow({"run_id": run_id, **r})

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=eval_run_{run_id}.csv"},
    )


@router.post("/{run_id}/cancel", response_model=EvalRunOut)
def cancel_eval_run(run_id: int, db: Session = Depends(get_db)):
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    if run.status in {"completed", "failed", "cancelled"}:
        return {
            "id": run.id,
            "timestamp": run.timestamp,
            "config_json": run.config_json,
            "status": run.status,
        }

    run.status = "cancel_requested"
    config = dict(run.config_json or {})
    config["cancelRequested"] = True
    run.config_json = config
    response_payload = {
        "id": run.id,
        "timestamp": run.timestamp,
        "config_json": config,
        "status": run.status,
    }
    db.commit()
    return response_payload


@router.get("/{run_id}/results")
def get_eval_results(run_id: int, db: Session = Depends(get_db)):
    from backend import models as db_models
    results_with_items = (
        db.query(db_models.EvalResult, db_models.GoldenItem)
        .outerjoin(db_models.GoldenItem, db_models.EvalResult.item_id == db_models.GoldenItem.id)
        .filter(db_models.EvalResult.run_id == run_id)
        .all()
    )
    return [
        {
            "id": r.id,
            "runId": r.run_id,
            "modelId": r.model_id,
            "metricName": r.metric_name,
            "score": r.score,
            "error": r.error,
            "rawOutput": r.raw_output,
            "itemId": r.item_id,
            "input": i.input if i else None,
            "expectedOutput": i.expected_output if i else None,
        }
        for (r, i) in results_with_items
    ]


@router.get("/{run_id}/progress")
async def get_eval_progress(run_id: int, db: Session = Depends(get_db)):
    """
    SSE endpoint — streams progress events for a running eval.
    Connect with EventSource('/api/eval-runs/:id/progress').
    """
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    async def event_generator():
        async for event in stream_progress(run_id):
            data = json.dumps(event)
            yield f"data: {data}\n\n"
            if event.get("done"):
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{run_id}/stats")
def get_eval_stats(run_id: int, db: Session = Depends(get_db)):
    """
    Returns aggregated stats (mean, 95% CI margin of error) grouped by model and metric.
    """
    from backend import models as db_models
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    results = (
        db.query(db_models.EvalResult)
        .filter(
            db_models.EvalResult.run_id == run_id,
            db_models.EvalResult.error.is_(False),
        )
        .all()
    )
    
    # Group by (model_id, metric_name)
    grouped = defaultdict(list)
    for r in results:
        grouped[(r.model_id, r.metric_name)].append(r.score)
        
    stats_out = []
    for (model_id, metric_name), scores in grouped.items():
        mean, lower, upper, moe = calculate_confidence_interval(scores)
        stats_out.append({
            "modelId": model_id,
            "metricName": metric_name,
            "mean": mean,
            "moe": moe,
            "count": len(scores)
        })
        
    return stats_out
