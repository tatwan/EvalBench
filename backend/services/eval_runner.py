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
from backend.scoring import rouge, bleu, meteor, exact_match, distinct, speed, embeddings, code_exec, bertscore
from backend.scoring.llm_judge import evaluate_with_llm
from backend.database import SessionLocal

# In-memory SSE queues keyed by run_id
_progress_queues: dict[int, asyncio.Queue] = {}


# ─── Task-type → scorer mapping ─────────────────────────

TASK_METRICS: dict[str, list[str]] = {
    "summarization": ["rouge1", "rouge2", "rougeL", "bertscore_f1", "llm_coherence", "llm_relevance"],
    "qa":            ["exact_match", "f1", "llm_relevance"],
    "chat":          ["distinct1", "llm_fluency", "llm_coherence"],
    "translation":   ["bleu", "chrf", "meteor"],
    "code":          ["rouge1", "distinct1"],  # Pass@k in Phase 3
    "reasoning":     ["exact_match", "f1"],
    "knowledge":     ["exact_match", "f1", "llm_relevance"],
    "embedding":     [],
}


def _score(task_type: str, prediction: str, reference: str, ollama_resp: dict) -> dict[str, float]:
    scores: dict[str, float] = {}

    tt = task_type.lower()

    if tt in ("summarization", "chat"):
        scores.update(rouge.compute(prediction, reference))
        scores.update(meteor.compute(prediction, reference))
        scores.update(bertscore.compute_single(prediction, reference))

    if tt in ("qa", "reasoning", "knowledge"):
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
    if ollama_resp:
        scores.update(speed.compute(ollama_resp))

    return scores

def _get_llm_metrics_for_task(task_type: str) -> list[str]:
    tt = task_type.lower()
    return [m for m in TASK_METRICS.get(tt, []) if m.startswith("llm_")]


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

    start_time: datetime | None = None
    try:
        run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
        if not run:
            return

        config = run.config_json or {}
        model_ids: list[int] = config.get("modelIds", [])
        task_type: str = config.get("taskType", "qa")
        dataset_id: int | None = config.get("datasetId")

        # ── update status ──
        start_time = datetime.utcnow()
        run.timestamp = start_time
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
            # Default: first dataset that roughly matches task type
            ds = (
                db.query(db_models.GoldenDataset)
                .filter(db_models.GoldenDataset.name.ilike(f"%{task_type}%"))
                .first()
            )
            if not ds:
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
        warned_bertscore = False
        for model in models:
            for item in items:
                try:
                    if task_type == "embedding":
                        context = json.loads(item.context or "{}") if item.context else {}
                        candidates = context.get("candidates", [])
                        answer_index = context.get("answer_index", 0)

                        query_res = await ollama_svc.embed(model.name, item.input)
                        if not query_res["ok"]:
                            raise RuntimeError(query_res.get("error", "Embedding failed"))

                        candidate_vecs = []
                        for cand in candidates:
                            cand_res = await ollama_svc.embed(model.name, cand)
                            if not cand_res["ok"]:
                                raise RuntimeError(cand_res.get("error", "Embedding failed"))
                            candidate_vecs.append(cand_res.get("embedding", []))

                        query_vec = query_res.get("embedding", [])
                        item_scores = embeddings.compute_embedding_metrics(query_vec, candidate_vecs, answer_index)

                        ranked, sims = embeddings.rank_by_similarity(query_vec, candidate_vecs)
                        top_idx = ranked[0] if ranked else None
                        top_match = candidates[top_idx] if top_idx is not None and top_idx < len(candidates) else None
                        raw_output = json.dumps({
                            "top_match": top_match,
                            "top_similarity": sims[top_idx] if top_idx is not None else None,
                            "ranked_indices": ranked,
                        })

                        for metric_name, score_value in item_scores.items():
                            storage.save_eval_result(
                                db,
                                run_id=run_id,
                                model_id=model.id,
                                metric_name=metric_name,
                                score=float(score_value),
                                raw_output=raw_output[:2000],
                                item_id=item.id,
                            )
                    else:
                        # Warn on first BERTScore usage (model download)
                        if task_type in ("summarization", "chat") and not warned_bertscore:
                            await q.put({
                                "type": "warning",
                                "message": "BERTScore may download a large model on first use (~400MB).",
                                "done": False,
                            })
                            warned_bertscore = True

                        result = await ollama_svc.generate(model.name, item.input)
                        prediction = result.get("response", "") if result["ok"] else ""

                        item_scores = _score(task_type, prediction, item.expected_output, result)

                        # Code execution scoring (Pass@1) when tests exist
                        if task_type == "code" and item.context:
                            try:
                                ctx = json.loads(item.context)
                                tests = ctx.get("tests")
                                if tests:
                                    score, err = code_exec.pass_at_1(prediction, tests)
                                    item_scores["pass_at_1"] = score
                                    if err and score == 0.0:
                                        prediction = f"{prediction}\n\n# Eval error: {err}"
                            except Exception:
                                pass

                        # Save traditional metrics
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

                        # Run and save LLM-as-Judge metrics
                        llm_metrics = _get_llm_metrics_for_task(task_type)
                        for metric_name in llm_metrics:
                            llm_score, rationale = evaluate_with_llm(db, metric_name, item.input, prediction)
                            # Save the score and embed the rationale in the raw_output field for now
                            formatted_output = f"{prediction[:1500]}\n\n--- Judge Rationale ---\n{rationale}"
                            storage.save_eval_result(
                                db,
                                run_id=run_id,
                                model_id=model.id,
                                metric_name=metric_name,
                                score=float(llm_score),
                                raw_output=formatted_output,
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

        duration_seconds = (datetime.utcnow() - (start_time or datetime.utcnow())).total_seconds()
        updated_config = dict(config)
        updated_config["durationSeconds"] = round(duration_seconds, 2)
        run.config_json = updated_config
        run.status = "completed"
        db.commit()
        await q.put({"type": "done", "status": "completed", "done": True})

    except Exception as e:
        try:
            run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
            if run:
                config = run.config_json or {}
                if start_time:
                    duration_seconds = (datetime.utcnow() - start_time).total_seconds()
                    updated_config = dict(config)
                    updated_config["durationSeconds"] = round(duration_seconds, 2)
                    run.config_json = updated_config
                run.status = "failed"
                db.commit()
        except Exception:
            pass
        await q.put({"type": "done", "status": "failed", "error": str(e), "done": True})
    finally:
        db.close()
