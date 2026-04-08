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
import logging
from datetime import datetime
from typing import AsyncIterator
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from backend import models as db_models
from backend.services import storage, ollama as ollama_svc
from backend.scoring import rouge, bleu, meteor, exact_match, distinct, speed, embeddings, code_exec, bertscore, classification, semantic_sim, toxicity
from backend.scoring.llm_judge import evaluate_with_llm, get_judge_client
from backend.database import SessionLocal
import math

# In-memory SSE queues keyed by run_id
_progress_queues: dict[int, asyncio.Queue] = {}

# Maximum concurrent (model × item) evaluations
CONCURRENCY = 4


# ─── Task-type → scorer mapping ─────────────────────────
# This is the single source of truth for which metrics run per task type.
# _score() below MUST stay in sync with this dict.

COMMON_SPEED_METRICS = [
    "tokens_per_second",
    "total_latency_s",
    "load_latency_s",
    "prompt_tokens",
    "output_tokens",
]

TASK_METRICS: dict[str, list[str]] = {
    "summarization": ["rouge1", "rouge2", "rougeL", "bertscore_f1", "meteor", "semantic_sim", *COMMON_SPEED_METRICS, "llm_coherence", "llm_relevance", "llm_faithfulness", "perplexity"],
    "qa":            ["exact_match", "f1", "semantic_sim", *COMMON_SPEED_METRICS, "llm_relevance", "llm_correctness", "llm_faithfulness", "perplexity"],
    "chat":          ["distinct1", "distinct2", "semantic_sim", *COMMON_SPEED_METRICS, "llm_fluency", "llm_coherence", "perplexity"],
    "translation":   ["bleu", "chrf", "meteor", "semantic_sim", *COMMON_SPEED_METRICS],
    "code":          ["rouge1", "distinct1", "pass_at_1", *COMMON_SPEED_METRICS],
    "reasoning":     ["exact_match", "f1", *COMMON_SPEED_METRICS, "llm_correctness"],
    "knowledge":     ["exact_match", "f1", *COMMON_SPEED_METRICS, "llm_relevance", "llm_correctness", "perplexity"],
    "embedding":     ["cosine_sim", "recall_at_1", "recall_at_3", "mrr"],
    "classification":["exact_match", *COMMON_SPEED_METRICS],
    "safety":        ["exact_match", "toxicity", *COMMON_SPEED_METRICS, "llm_relevance"],
}

DEFAULT_DATASET_BY_TASK: dict[str, str] = {
    "summarization": "EvalBench Summarization v1",
    "qa": "EvalBench QA v1",
    "chat": "EvalBench TruthfulQA (Subset)",
    "translation": "EvalBench Translation v1",
    "code": "EvalBench HumanEval (Subset)",
    "reasoning": "EvalBench GSM8K (Subset)",
    "knowledge": "EvalBench MMLU (Subset)",
    "embedding": "EvalBench Embeddings v1",
    "classification": "EvalBench Classification v1",
    "safety": "EvalBench TruthfulQA (Subset)",
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

    # — QA / Reasoning / Knowledge / Safety — exact string metrics only
    elif tt in ("qa", "reasoning", "knowledge", "safety"):
        scores.update(exact_match.compute(prediction, reference))  # exact_match, f1

    # — Classification —
    elif tt == "classification":
        scores.update(classification.compute(prediction, reference)) # exact_match (accuracy)

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

    # --- New Metrics (E2, E11, E12) ---
    if "semantic_sim" in TASK_METRICS.get(tt, []) and semantic_sim.is_available() and reference:
        scores["semantic_sim"] = semantic_sim.compute_similarity(prediction, reference)

    if "toxicity" in TASK_METRICS.get(tt, []) and toxicity.is_available():
        scores["toxicity"] = toxicity.compute_toxicity(prediction)

    if "perplexity" in TASK_METRICS.get(tt, []):
        lp_data = ollama_resp.get("logprobs")
        if isinstance(lp_data, list) and len(lp_data) > 0:
            total_lp = 0.0
            valid_tokens = 0
            for token_obj in lp_data:
                if isinstance(token_obj, dict) and isinstance(token_obj.get("logprob"), (float, int)):
                    total_lp += float(token_obj["logprob"])
                    valid_tokens += 1
            if valid_tokens > 0:
                try:
                    scores["perplexity"] = math.exp(-total_lp / valid_tokens)
                except Exception:
                    scores["perplexity"] = float("inf")

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


def is_terminal_status(status: str | None) -> bool:
    return status in {"completed", "failed", "cancelled"}


async def stream_progress(run_id: int) -> AsyncIterator[dict]:
    """SSE generator — yields progress events for a run."""
    q = get_or_create_queue(run_id)
    idle_time = 0
    while True:
        try:
            event = await asyncio.wait_for(q.get(), timeout=15)
            idle_time = 0
            yield event
            if event.get("done"):
                _progress_queues.pop(run_id, None)
                break
        except asyncio.TimeoutError:
            idle_time += 15
            db = SessionLocal()
            try:
                run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
                if run and is_terminal_status(run.status):
                    yield {"type": "done", "status": run.status, "done": True}
                    _progress_queues.pop(run_id, None)
                    break
            finally:
                db.close()

            if idle_time >= 300:
                yield {"type": "done", "status": "failed", "error": "Progress stream timed out", "done": True}
                _progress_queues.pop(run_id, None)
                break

            # Send keepalive to prevent client timeout
            yield {"type": "keepalive", "done": False}


async def run_eval(run_id: int) -> None:
    """
    Background task that executes a full evaluation run.
    Uses its own DB session since it runs outside the request lifecycle.
    """
    db: Session = SessionLocal()
    q = get_or_create_queue(run_id)

    start_time: datetime | None = None
    run: db_models.EvalRun | None = None
    pair_failures = 0
    failure_messages: list[str] = []
    retry_count = 0
    cache_hits = 0
    try:
        run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
        if not run:
            return

        if run.status == "cancel_requested":
            run.status = "cancelled"
            db.commit()
            await q.put({"type": "done", "status": "cancelled", "done": True})
            return

        config = run.config_json or {}
        model_ids: list[int] = config.get("modelIds", [])
        task_type: str = config.get("taskType", "qa")
        dataset_id: int | None = config.get("datasetId")
        cloud_model_names: list[str] = config.get("cloudModels", [])

        # ── update status ──
        start_time = datetime.utcnow()
        run.timestamp = start_time
        run.status = "running"
        run.config_json = {**config}
        db.commit()

        await q.put({"type": "status", "status": "running", "done": False})

        # ── load models ──
        models = db.query(db_models.Model).filter(db_models.Model.id.in_(model_ids)).all()
        if not models and not cloud_model_names:
            raise ValueError("No valid models were found for this evaluation run.")

        # ── load dataset items ──
        if dataset_id:
            items = db.query(db_models.GoldenItem).filter_by(dataset_id=dataset_id).all()
            if not items:
                raise ValueError("The selected dataset is missing or contains no items.")
        else:
            # Default: use an explicit task-to-dataset mapping rather than a fuzzy match.
            dataset_name = DEFAULT_DATASET_BY_TASK.get(task_type.lower())
            ds = None
            if dataset_name:
                ds = db.query(db_models.GoldenDataset).filter_by(name=dataset_name).first()
            if not ds:
                ds = db.query(db_models.GoldenDataset).first()
            items = db.query(db_models.GoldenItem).filter_by(dataset_id=ds.id).all() if ds else []

        if not items:
            raise ValueError(f"No dataset items are available for task type '{task_type}'.")

        total = len(models) * len(items)
        completed = 0
        semaphore = asyncio.Semaphore(CONCURRENCY)
        run.config_json = {
            **(run.config_json or {}),
            "totalPairs": total,
            "completedPairs": 0,
            "errorCount": 0,
            "retryCount": 0,
            "cacheHits": 0,
        }
        db.commit()

        await q.put({"type": "start", "total": total, "done": False})

        # Warn once if BERTScore is expected but unavailable for this task
        if task_type == "summarization" and not bertscore.is_available():
            logger.warning(
                "BERTScore is in TASK_METRICS for summarization but bert_score is not available. "
                "bertscore_f1 will be absent from this run's results. "
                "To enable: pip install bert-score"
            )

        # BERTScore download warning — emit once before the loop
        if task_type == "summarization" and bertscore.is_available():
            await q.put({
                "type": "warning",
                "message": "BERTScore may download a large model on first use (~400MB).",
                "done": False,
            })

        # ── concurrent evaluation ──
        async def eval_pair(model: db_models.Model, item: db_models.GoldenItem) -> None:
            nonlocal completed, pair_failures, retry_count, cache_hits
            async with semaphore:
                db_local: Session = SessionLocal()
                try:
                    current_run = db_local.query(db_models.EvalRun).filter_by(id=run_id).first()
                    if not current_run or current_run.status == "cancel_requested":
                        return

                    results_to_save: list[dict] = []  # accumulate, then bulk-commit

                    if task_type == "embedding":
                        context = json.loads(item.context or "{}") if item.context else {}
                        candidates = context.get("candidates", [])
                        answer_index = context.get("answer_index", 0)

                        query_res = await ollama_svc.embed(model.name, item.input)
                        retry_count += int(query_res.get("retries", 0))
                        if not query_res["ok"]:
                            raise RuntimeError(query_res.get("error", "Embedding failed"))

                        candidate_vecs = []
                        for cand in candidates:
                            cand_res = await ollama_svc.embed(model.name, cand)
                            retry_count += int(cand_res.get("retries", 0))
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
                            cache_hits += 1
                            result = {
                                "ok": True,
                                "response": cached.response,
                                "eval_count": cached.eval_count,
                                "eval_duration": cached.eval_duration,
                                "retries": 0,
                                "cache_hit": True,
                            }
                        else:
                            result = await ollama_svc.generate(model.name, item.input)
                            retry_count += int(result.get("retries", 0))
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
                            pair_failures += 1
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
                            item_scores = await asyncio.to_thread(
                                _score, task_type, prediction, item.expected_output, result
                            )

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
                                llm_score, rationale = await asyncio.to_thread(
                                    evaluate_with_llm, db_local, metric_name, item.input, prediction, item.context or ""
                                )
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
                    pair_failures += 1
                    failure_messages.append(f"{model.name} / item {item.id}: {str(e)}")
                    await q.put({"type": "error", "message": str(e), "done": False})
                finally:
                    db_local.close()

                completed += 1
                progress_db: Session = SessionLocal()
                try:
                    progress_run = progress_db.query(db_models.EvalRun).filter_by(id=run_id).first()
                    if progress_run and not is_terminal_status(progress_run.status):
                        progress_config = dict(progress_run.config_json or {})
                        progress_config["completedPairs"] = completed
                        progress_config["errorCount"] = pair_failures
                        progress_config["retryCount"] = retry_count
                        progress_config["cacheHits"] = cache_hits
                        progress_run.config_json = progress_config
                        progress_db.commit()
                finally:
                    progress_db.close()
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

        # ── Cloud model inference (via judge client) ──────────────────────────
        if cloud_model_names:
            db_session = SessionLocal()
            try:
                judge_client, judge_model_name, anthropic_client, setup_error = get_judge_client(db_session)
            finally:
                db_session.close()

            if setup_error:
                logger.warning(f"Cloud model inference skipped — judge not configured: {setup_error}")
            else:
                for cloud_model_name in cloud_model_names:
                    db_session = SessionLocal()
                    try:
                        virtual_model = db_session.query(db_models.Model).filter_by(name=cloud_model_name).first()
                        if not virtual_model:
                            virtual_model = db_models.Model(
                                name=cloud_model_name,
                                size=0,
                                family="cloud",
                                parameter_size="unknown",
                                quantization_level="none",
                            )
                            db_session.add(virtual_model)
                            db_session.commit()
                            db_session.refresh(virtual_model)
                        virtual_model_id = virtual_model.id
                    finally:
                        db_session.close()

                    for item in items:
                        try:
                            if anthropic_client:
                                resp = anthropic_client.messages.create(
                                    model=cloud_model_name,
                                    max_tokens=512,
                                    messages=[{"role": "user", "content": item.input}],
                                )
                                prediction = resp.content[0].text.strip()
                            else:
                                resp = judge_client.chat.completions.create(
                                    model=cloud_model_name,
                                    messages=[{"role": "user", "content": item.input}],
                                    max_tokens=512,
                                )
                                prediction = resp.choices[0].message.content.strip()

                            scores = _score(task_type, prediction, item.expected_output or "", {})
                            db_session = SessionLocal()
                            try:
                                for metric_name, score_val in scores.items():
                                    storage.save_eval_result(
                                        db_session, run.id, virtual_model_id,
                                        metric_name, score_val,
                                        raw_output=prediction[:2000],
                                        item_id=item.id,
                                    )
                            finally:
                                db_session.close()
                        except Exception as e:
                            logger.warning(f"Cloud model inference failed for item {item.id}: {e}")

        db.refresh(run)
        duration_seconds = (datetime.utcnow() - (start_time or datetime.utcnow())).total_seconds()
        updated_config = dict(config)
        updated_config["durationSeconds"] = round(duration_seconds, 2)
        updated_config["totalPairs"] = total
        updated_config["completedPairs"] = completed
        updated_config["retryCount"] = retry_count
        updated_config["cacheHits"] = cache_hits
        if pair_failures:
            updated_config["errorCount"] = pair_failures
            updated_config["errors"] = failure_messages[:10]
        run.config_json = updated_config
        if run.status == "cancel_requested":
            run.status = "cancelled"
        else:
            run.status = "failed" if pair_failures else "completed"
        db.commit()
        await q.put({
            "type": "done",
            "status": run.status,
            "errorCount": pair_failures,
            "done": True,
        })

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
                run.status = "cancelled" if run.status == "cancel_requested" else "failed"
                db.commit()
        except Exception:
            pass
        await q.put({
            "type": "done",
            "status": "cancelled" if run and run.status == "cancel_requested" else "failed",
            "error": str(e),
            "done": True,
        })
    finally:
        db.close()
