from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import asyncio
import json

from backend.database import get_db
from backend.services import storage
from backend.services.eval_runner import run_eval, stream_progress
from backend.schemas import EvalRunOut, EvalRunCreate

router = APIRouter(prefix="/api/eval-runs", tags=["eval-runs"])


@router.get("", response_model=list[EvalRunOut])
def list_eval_runs(db: Session = Depends(get_db)):
    return storage.get_all_eval_runs(db)


@router.post("", response_model=EvalRunOut, status_code=201)
async def create_eval_run(
    payload: EvalRunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    config = {
        "modelIds": payload.model_ids,
        "taskType": payload.task_type,
        "datasetId": payload.dataset_id,
        # legacy field — keep for dashboard display
        "benchmarkKeys": [payload.task_type],
    }
    run = storage.create_eval_run(db, config)
    # Launch the runner as a background task (non-blocking)
    background_tasks.add_task(run_eval, run.id)
    return run


@router.get("/{run_id}", response_model=EvalRunOut)
def get_eval_run(run_id: int, db: Session = Depends(get_db)):
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return run


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
