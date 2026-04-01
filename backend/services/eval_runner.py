"""
Eval Runner — executes an EvalRun in the background.

Workflow for each run:
  1. Load config (model IDs, task type, dataset ID)
  2. Fan out (model × item) pairs via asyncio.Semaphore for bounded concurrency
  3. For each pair:
     a. Call ollama.generate()
     b. Score with ONLY the metrics that TASK_METRICS declares for that task type
     c. Accumulate EvalResult rows, commit once per item (not per metric)
     d. Emit SSE progress event
  4. Update EvalRun.status → "completed" or "failed"

Fixes applied:
  B1  — _score() is now driven entirely by TASK_METRICS; no rogue cross-task metrics.
  B3  — DB commits are batched: one commit per (model, item) pair, not per metric.
  I11 — asyncio.Semaphore(CONCURRENCY) lets multiple (model, item) pairs run in parallel.
"""
import asyncio
import hashlib
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

# Maximum concurrent (model × item) evaluations
CONCURRENCY = 4


# ─── Task-type → scorer mapping ─────────────────────────
# This is the single source of truth for which metrics run per task type.
# _score() below MUST stay in sync with this dict.

TASK_METRICS: dict[str, list[str]] = {
    "summarization": ["rouge1", "rouge2", "rougeL", "bertscore_f1", "meteor", "tps", "llm_coherence", "llm_relevance"],
    "qa":            ["exact_match", "f1", "tps", "llm_relevance"],
    "chat":          ["distinct1", "distinct2", "tps", "llm_fluency", "llm_coherence"],
    "translation":   ["bleu", "chrf", "meteor", "tps"],
    "code":          ["rouge1", "distinct1", "pass_at_1", "tps"],
    "reasoning":     ["exact_match", "f1", "tps"],
    "knowledge":     ["exact_match", "f1", "tps", "llm_relevance"],
    "embedding":     ["cosine_sim", "recall_at_1", "recall_at_3", "mrr"],
}


def _score(task_type: str, prediction: str, reference: str, ollama_resp: dict) -> dict[str, float]:
    """
    Compute non-LLM metrics for a (prediction, reference) pair.
    The returned keys MUST be a subset of TASK_METRICS[task_type] (excluding llm_* keys,
    which are handled separately by evaluate_with_llm).
    """
    scores: dict[str, float] = {}
    tt = task_type.lower()

    # — Summarization —
    if tt == "summarization":
        scores.update(rouge.compute(prediction, reference))      # rouge1, rouge2, rougeL
        scores.update(meteor.compute(prediction, reference))     # meteor
        scores.update(bertscore.compute_single(prediction, reference))  # bertscore_f1

    # — QA / Reasoning / Knowledge — exact string metrics only
    elif tt in ("qa", "reasoning", "knowledge"):
        scores.update(exact_match.compute(prediction, reference))  # exact_match, f1

    # — Chat — diversity metrics only (no reference comparison)
    elif tt == "chat":
        scores.update(distinct.compute(prediction))              # distinct1, distinct2

    # — Translation —
    elif tt == "translation":
        scores.update(bleu.compute(prediction, reference))       # bleu, chrf
        scores.update(meteor.compute(prediction, reference))     # meteor

    # — Code — surface similarity + pass@1 handled separately below
    elif tt == "code":
        scores.update(rouge.compute(prediction, reference))      # rouge1 (structural)
        scores.update(distinct.compute(prediction))              # distinct1

    # — Embedding — handled entirely in run_eval (requires vector calls)

    # Speed metrics available for all non-embedding tasks
    if tt != "embedding" and ollama_resp:
        scores.update(speed.compute(ollama_resp))                # tps, latency_ms, etc.

    return scores


def _get_llm_metrics_for_task(task_type: str) -> list[str]:
    return [m for m in TASK_METRICS.get(task_type.lower(), []) if m.startswith("llm_")]


def get_or_create_queue(run_id: int) -> asyncio.Queue:
    if run_id not in _progress_queues:
        _progress_queues[run_id] = asyncio.Queue()
    return _progress_queues[run_id]


async def stream_progress(run_id: int) -> AsyncIterator[dict]:
    """SSE generator — yields progress events for a run."""
    q = get_or_create_queue(run_id)
    while True:
        try:
            event = await asyncio.wait_for(q.get(), timeout=300)
        except asyncio.TimeoutError:
            # Send keepalive to prevent client timeout; check if run is gone
            yield {"type": "keepalive", "done": False}
            continue
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
            items = db.query(db_models.GoldenItem).filter_by(dataset_id=dataset_id).all()
        else:
            # Default: first dataset that roughly matches task type by name
            ds = (
                db.query(db_models.GoldenDataset)
                .filter(db_models.GoldenDataset.name.ilike(f"%{task_type}%"))
                .first()
            )
            if not ds:
                ds = db.query(db_models.GoldenDataset).first()
            items = db.query(db_models.GoldenItem).filter_by(dataset_id=ds.id).all() if ds else []

        total = len(models) * len(items)
        completed = 0
        semaphore = asyncio.Semaphore(CONCURRENCY)

        await q.put({"type": "start", "total": total, "done": False})

        # BERTScore download warning — emit once before the loop
        if task_type == "summarization" and bertscore.is_available():
            await q.put({
                "type": "warning",
                "message": "BERTScore may download a large model on first use (~400MB).",
                "done": False,
            })

        # ── concurrent evaluation ──
        async def eval_pair(model: db_models.Model, item: db_models.GoldenItem) -> None:
            nonlocal completed
            async with semaphore:
                db_local: Session = SessionLocal()
                try:
                    results_to_save: list[dict] = []  # accumulate, then bulk-commit

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
                            results_to_save.append(dict(
                                run_id=run_id, model_id=model.id,
                                metric_name=metric_name, score=float(score_value), error=False,
                                raw_output=raw_output[:2000], item_id=item.id,
                            ))

                    else:
                        cache_key = hashlib.sha256(f"{model.name}:{item.input}".encode("utf-8")).hexdigest()
                        cached = db_local.query(db_models.ResponseCache).filter_by(key=cache_key).first()
                        
                        if cached:
                            result = {
                                "ok": True,
                                "response": cached.response,
                                "eval_count": cached.eval_count,
                                "eval_duration": cached.eval_duration
                            }
                        else:
                            result = await ollama_svc.generate(model.name, item.input)
                            if result.get("ok"):
                                new_cache = db_models.ResponseCache(
                                    key=cache_key,
                                    response=result.get("response", ""),
                                    eval_count=result.get("eval_count"),
                                    eval_duration=result.get("eval_duration")
                                )
                                db_local.add(new_cache)
                        
                        if not result.get("ok"):
                            # Inference failed — record an error for every expected metric
                            err_msg = result.get("error", "Inference failed")
                            all_metrics = TASK_METRICS.get(task_type.lower(), [])
                            for metric_name in all_metrics:
                                results_to_save.append(dict(
                                    run_id=run_id, model_id=model.id,
                                    metric_name=metric_name, score=0.0, error=True,
                                    raw_output=err_msg, item_id=item.id,
                                ))
                        else:
                            prediction = result.get("response", "")

                            # Traditional metrics (TASK_METRICS-aligned, no cross-task leakage)
                            item_scores = _score(task_type, prediction, item.expected_output, result)

                            # Code execution scoring (Pass@1)
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

                            for metric_name, score_value in item_scores.items():
                                results_to_save.append(dict(
                                    run_id=run_id, model_id=model.id,
                                    metric_name=metric_name, score=float(score_value), error=False,
                                    raw_output=prediction[:2000], item_id=item.id,
                                ))

                            # LLM-as-Judge metrics
                            llm_metrics = _get_llm_metrics_for_task(task_type)
                            for metric_name in llm_metrics:
                                llm_score, rationale = evaluate_with_llm(db_local, metric_name, item.input, prediction)
                                formatted_output = f"{prediction[:1500]}\n\n--- Judge Rationale ---\n{rationale}"
                                results_to_save.append(dict(
                                    run_id=run_id, model_id=model.id,
                                    metric_name=metric_name, score=float(llm_score), error=False,
                                    raw_output=formatted_output, item_id=item.id,
                                ))

                    # ── Bulk insert all results for this (model, item) pair — one commit ──
                    for r in results_to_save:
                        db_local.add(db_models.EvalResult(**r))
                    db_local.commit()

                except Exception as e:
                    await q.put({"type": "error", "message": str(e), "done": False})
                finally:
                    db_local.close()

                completed += 1
                pct = round(completed / total * 100) if total else 100
                await q.put({
                    "type": "progress",
                    "completed": completed,
                    "total": total,
                    "percent": pct,
                    "model": model.name,
                    "done": False,
                })

        # Launch all (model, item) pairs; semaphore bounds concurrency
        tasks = [eval_pair(model, item) for model in models for item in items]
        await asyncio.gather(*tasks)

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
