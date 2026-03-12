"""
Eval Runner — executes an EvalRun in the background.

Workflow for each run:
  1. Load config (model IDs, task type, dataset ID)
  2. For each (model, dataset_item) pair:
     a. Call ollama.generate()
     b. Score with appropriate metrics for the task type
     c. Write EvalResult rows to DB
     d. Emit SSE progress event
  3. Update EvalRun.status → "completed" or "failed"
"""
import asyncio
import json
from datetime import datetime
from typing import AsyncIterator
from sqlalchemy.orm import Session

from backend import models as db_models
from backend.services import storage, ollama as ollama_svc
from backend.scoring import rouge, bleu, meteor, exact_match, distinct, speed
from backend.database import SessionLocal

# In-memory SSE queues keyed by run_id
_progress_queues: dict[int, asyncio.Queue] = {}


# ─── Task-type → scorer mapping ─────────────────────────

TASK_METRICS: dict[str, list[str]] = {
    "summarization": ["rouge1", "rouge2", "rougeL", "meteor"],
    "qa":            ["exact_match", "f1", "rouge1"],
    "chat":          ["distinct1", "distinct2", "rouge1"],
    "translation":   ["bleu", "chrf", "meteor"],
    "code":          ["rouge1", "distinct1"],  # Pass@k in Phase 3
    "reasoning":     ["exact_match", "f1"],
}


def _score(task_type: str, prediction: str, reference: str, ollama_resp: dict) -> dict[str, float]:
    scores: dict[str, float] = {}

    tt = task_type.lower()

    if tt in ("summarization", "chat"):
        scores.update(rouge.compute(prediction, reference))
        scores.update(meteor.compute(prediction, reference))

    if tt == "qa" or tt == "reasoning":
        scores.update(exact_match.compute(prediction, reference))
        scores.update(rouge.compute(prediction, reference))

    if tt == "translation":
        scores.update(bleu.compute(prediction, reference))
        scores.update(meteor.compute(prediction, reference))

    if tt == "code":
        scores.update(rouge.compute(prediction, reference))

    # Always add distinct-n for chat/open-ended
    if tt in ("chat", "code"):
        scores.update(distinct.compute(prediction))

    # Always add speed metrics from Ollama timing
    scores.update(speed.compute(ollama_resp))

    return scores


def get_or_create_queue(run_id: int) -> asyncio.Queue:
    if run_id not in _progress_queues:
        _progress_queues[run_id] = asyncio.Queue()
    return _progress_queues[run_id]


async def stream_progress(run_id: int) -> AsyncIterator[dict]:
    """SSE generator — yields progress events for a run."""
    q = get_or_create_queue(run_id)
    while True:
        event = await q.get()
        yield event
        if event.get("done"):
            _progress_queues.pop(run_id, None)
            break


async def run_eval(run_id: int) -> None:
    """
    Background task that executes a full evaluation run.
    Uses its own DB session since it runs outside the request lifecycle.
    """
    db: Session = SessionLocal()
    q = get_or_create_queue(run_id)

    try:
        run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
        if not run:
            return

        config = run.config_json or {}
        model_ids: list[int] = config.get("modelIds", [])
        task_type: str = config.get("taskType", "qa")
        dataset_id: int | None = config.get("datasetId")

        # ── update status ──
        run.status = "running"
        db.commit()

        await q.put({"type": "status", "status": "running", "done": False})

        # ── load models ──
        models = db.query(db_models.Model).filter(db_models.Model.id.in_(model_ids)).all()

        # ── load dataset items ──
        if dataset_id:
            items = (
                db.query(db_models.GoldenItem)
                .filter_by(dataset_id=dataset_id)
                .all()
            )
        else:
            # Default: first matching task-type dataset
            ds = db.query(db_models.GoldenDataset).first()
            items = (
                db.query(db_models.GoldenItem).filter_by(dataset_id=ds.id).all()
                if ds
                else []
            )

        total = len(models) * len(items)
        completed = 0

        await q.put({"type": "start", "total": total, "done": False})

        # ── evaluate ──
        for model in models:
            for item in items:
                try:
                    result = await ollama_svc.generate(model.name, item.input)
                    prediction = result.get("response", "") if result["ok"] else ""

                    item_scores = _score(task_type, prediction, item.expected_output, result)

                    for metric_name, score_value in item_scores.items():
                        storage.save_eval_result(
                            db,
                            run_id=run_id,
                            model_id=model.id,
                            metric_name=metric_name,
                            score=float(score_value),
                            raw_output=prediction[:2000],
                            item_id=item.id,
                        )
                except Exception as e:
                    await q.put({"type": "error", "message": str(e), "done": False})

                completed += 1
                pct = round(completed / total * 100)
                await q.put({
                    "type": "progress",
                    "completed": completed,
                    "total": total,
                    "percent": pct,
                    "model": model.name,
                    "done": False,
                })

        run.status = "completed"
        db.commit()
        await q.put({"type": "done", "status": "completed", "done": True})

    except Exception as e:
        try:
            run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
            if run:
                run.status = "failed"
                db.commit()
        except Exception:
            pass
        await q.put({"type": "done", "status": "failed", "error": str(e), "done": True})
    finally:
        db.close()
