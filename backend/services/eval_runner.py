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
import time
from datetime import datetime, timezone
from typing import Any, AsyncIterator
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from backend import models as db_models
from backend.services import storage, ollama as ollama_svc
from backend.scoring import rouge, bleu, meteor, exact_match, distinct, speed, embeddings, code_exec, bertscore, classification, semantic_sim, toxicity
from backend.scoring import rag as rag_scoring
from backend.scoring.llm_judge import (
    evaluate_with_llm,
    get_judge_client,
    get_judge_model_name,
    get_model_client,
    judge_is_enabled,
    _chat_completion_with_fallback,
    _embedding_with_fallback,
)
from backend.database import SessionLocal
import math

# In-memory SSE queues keyed by run_id
_progress_queues: dict[int, asyncio.Queue] = {}

# Maximum concurrent (model × item) evaluations
CONCURRENCY = 4
CODE_MAX_ATTEMPTS = 3


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

CACHE_SPEED_KEYS = (
    "eval_count",
    "eval_duration",
    "prompt_eval_count",
    "load_duration",
    "total_duration",
    "logprobs",
)

TASK_METRICS: dict[str, list[str]] = {
    "summarization": ["rouge1", "rouge2", "rougeL", "rougeLsum", "bertscore_f1", "meteor", "semantic_sim", *COMMON_SPEED_METRICS, "llm_coherence", "llm_relevance", "llm_faithfulness", "perplexity"],
    "qa":            ["exact_match", "f1", "semantic_sim", *COMMON_SPEED_METRICS, "llm_relevance", "llm_correctness", "llm_faithfulness", "perplexity"],
    "chat":          ["distinct1", "distinct2", "semantic_sim", *COMMON_SPEED_METRICS, "llm_fluency", "llm_coherence", "perplexity"],
    "translation":   ["bleu", "chrf", "meteor", "semantic_sim", *COMMON_SPEED_METRICS],
    "code":          ["rouge1", "distinct1", "pass_at_1", "pass_at_3", *COMMON_SPEED_METRICS],
    "reasoning":     ["exact_match", "f1", *COMMON_SPEED_METRICS, "llm_correctness"],
    "knowledge":     ["exact_match", "f1", *COMMON_SPEED_METRICS, "llm_relevance", "llm_correctness", "perplexity"],
    "embedding":     ["cosine_sim", "recall_at_1", "recall_at_3", "mrr", "ndcg"],
    "classification":["exact_match", *COMMON_SPEED_METRICS],
    "safety":        ["exact_match", "toxicity", *COMMON_SPEED_METRICS, "llm_relevance"],
    "rag":           ["context_relevance", "faithfulness", *COMMON_SPEED_METRICS],
}

DEFAULT_DATASET_BY_TASK: dict[str, str] = {
    "summarization": "EvalBench Summarization v1",
    "qa": "EvalBench QA v1",
    "chat": "EvalBench TruthfulQA (Subset)",
    "translation": "EvalBench Translation v1",
    "code": "EvalBench HumanEval (Expanded v2)",
    "reasoning": "EvalBench GSM8K (Expanded v2)",
    "knowledge": "EvalBench MMLU (Expanded v2)",
    "embedding": "EvalBench Embeddings v1",
    "classification": "EvalBench Classification v1",
    "safety": "EvalBench TruthfulQA (MC v2)",
    "rag": "EvalBench RAG v1",
}


def _score(task_type: str, prediction: str, reference: str, ollama_resp: dict) -> dict[str, float]:
    """
    Compute non-LLM metrics for a (prediction, reference) pair.
    The returned keys MUST be a subset of TASK_METRICS[task_type] (excluding llm_* keys,
    which are handled separately by evaluate_with_llm).
    """
    scores: dict[str, float] = {}
    tt = task_type.lower()
    prediction = prediction or ""
    reference = reference or ""

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

    # — RAG — all metrics handled in run_eval() via rag_scoring.compute_rag_metrics()
    elif tt == "rag":
        pass

    # — Code — surface similarity + pass@1 handled separately below
    elif tt == "code":
        scores.update(rouge.compute(prediction, reference))      # rouge1 (structural)
        scores.update(distinct.compute(prediction))              # distinct1

    # --- New Metrics (E2, E11, E12) ---
    if "semantic_sim" in TASK_METRICS.get(tt, []) and semantic_sim.is_available() and reference:
        try:
            scores["semantic_sim"] = semantic_sim.compute_similarity(prediction, reference)
        except Exception as exc:
            logger.warning(f"Semantic similarity computation failed: {exc}")

    if "toxicity" in TASK_METRICS.get(tt, []) and toxicity.is_available():
        try:
            scores["toxicity"] = toxicity.compute_toxicity(prediction)
        except Exception as exc:
            logger.warning(f"Toxicity computation failed: {exc}")

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
    if tt != "embedding" and any(key in ollama_resp for key in CACHE_SPEED_KEYS):
        try:
            scores.update(speed.compute(ollama_resp))                # tps, latency_ms, etc.
        except Exception as exc:
            logger.warning(f"Speed metric computation failed: {exc}")

    return scores


def _response_cache_key(model_name: str, prompt: str, attempt_index: int = 0) -> str:
    raw = f"{model_name}:{prompt}" if attempt_index == 0 else f"{model_name}:{prompt}:attempt:{attempt_index}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _code_attempt_temperature(attempt_index: int) -> float | None:
    if attempt_index == 0:
        return None
    return min(1.0, 0.7 + (attempt_index * 0.15))


def _format_code_attempt_summary(
    attempt_scores: list[tuple[float, str]],
    generation_errors: list[str],
    display_attempt_index: int,
) -> str:
    lines = [
        f"# EvalBench code attempts: pass@1={'pass' if attempt_scores and attempt_scores[0][0] >= 1.0 else 'fail'}, "
        f"pass@3={'pass' if any(score >= 1.0 for score, _ in attempt_scores[:3]) else 'fail'}",
    ]
    for idx, (score, message) in enumerate(attempt_scores, start=1):
        status = "pass" if score >= 1.0 else "fail"
        detail = message if message else "no details"
        lines.append(f"# Attempt {idx}: {status} - {detail}")
    for message in generation_errors:
        lines.append(f"# {message}")
    if display_attempt_index > 0:
        lines.append(f"# Displayed code is from attempt {display_attempt_index + 1}, which was the first passing sample.")
    return "\n".join(lines)


async def _generate_local_attempt(db_local: Session, model_name: str, prompt: str, attempt_index: int = 0) -> tuple[dict, int]:
    cache_key = _response_cache_key(model_name, prompt, attempt_index)
    cached = db_local.query(db_models.ResponseCache).filter_by(key=cache_key).first()

    if cached:
        cached_payload = _decode_cached_payload(cached)
        return {
            "ok": True,
            "response": cached_payload.get("response", ""),
            "eval_count": cached_payload.get("eval_count"),
            "eval_duration": cached_payload.get("eval_duration"),
            "prompt_eval_count": cached_payload.get("prompt_eval_count"),
            "load_duration": cached_payload.get("load_duration"),
            "total_duration": cached_payload.get("total_duration"),
            "logprobs": cached_payload.get("logprobs"),
            "retries": 0,
            "cache_hit": True,
        }, 1

    result = await ollama_svc.generate(
        model_name,
        prompt,
        temperature=_code_attempt_temperature(attempt_index),
    )
    if result.get("ok"):
        db_local.add(db_models.ResponseCache(
            key=cache_key,
            response=_encode_cached_payload(result),
            eval_count=result.get("eval_count"),
            eval_duration=result.get("eval_duration"),
        ))
    return result, 0


async def _generate_cloud_attempt(
    *,
    client: Any,
    anthropic_client: Any,
    model_name: str,
    prompt: str,
    attempt_index: int = 0,
) -> tuple[Any, str, float]:
    temperature = _code_attempt_temperature(attempt_index) or 0.7
    started_at = time.perf_counter()
    if anthropic_client:
        resp = anthropic_client.messages.create(
            model=model_name,
            max_tokens=512,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        prediction = resp.content[0].text.strip()
    else:
        resp = _chat_completion_with_fallback(
            client=client,
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_output_tokens=512,
        )
        prediction = resp.choices[0].message.content.strip()
    elapsed_seconds = time.perf_counter() - started_at
    return resp, prediction, elapsed_seconds


def _encode_cached_payload(result: dict) -> str:
    payload = {
        "response": result.get("response", ""),
        "eval_count": result.get("eval_count"),
        "eval_duration": result.get("eval_duration"),
        "prompt_eval_count": result.get("prompt_eval_count"),
        "load_duration": result.get("load_duration"),
        "total_duration": result.get("total_duration"),
        "logprobs": result.get("logprobs"),
    }
    return json.dumps(payload)


def _decode_cached_payload(cached: db_models.ResponseCache) -> dict:
    response_text = cached.response or ""
    try:
        payload = json.loads(response_text)
        if isinstance(payload, dict) and "response" in payload:
            return {
                "response": payload.get("response", ""),
                "eval_count": payload.get("eval_count"),
                "eval_duration": payload.get("eval_duration"),
                "prompt_eval_count": payload.get("prompt_eval_count"),
                "load_duration": payload.get("load_duration"),
                "total_duration": payload.get("total_duration"),
                "logprobs": payload.get("logprobs"),
            }
    except Exception:
        pass
    return {
        "response": response_text,
        "eval_count": cached.eval_count,
        "eval_duration": cached.eval_duration,
    }


def _get_llm_metrics_for_task(task_type: str) -> list[str]:
    return [m for m in TASK_METRICS.get(task_type.lower(), []) if m.startswith("llm_")]


def _get_metrics_for_run(task_type: str, judge_available: bool) -> list[str]:
    metrics = []
    for metric_name in TASK_METRICS.get(task_type.lower(), []):
        if metric_name.startswith("llm_") and not judge_available:
            continue
        if task_type.lower() == "rag" and metric_name in {"context_relevance", "faithfulness"} and not judge_available:
            continue
        metrics.append(metric_name)
    return metrics


def _persist_error_rows(
    db: Session,
    *,
    run_id: int,
    model_id: int,
    task_type: str,
    item_id: int,
    message: str,
    metrics: list[str] | None = None,
) -> None:
    for metric_name in metrics or TASK_METRICS.get(task_type.lower(), []):
        db.add(
            db_models.EvalResult(
                run_id=run_id,
                model_id=model_id,
                metric_name=metric_name,
                score=0.0,
                error=True,
                raw_output=message,
                item_id=item_id,
            )
        )
    db.commit()


def _is_permanent_provider_error(message: str) -> bool:
    text = (message or "").lower()
    return any(
        marker in text
        for marker in (
            "incorrect api key",
            "invalid api key",
            "api key not valid",
            "authentication",
            "unauthorized",
            "forbidden",
            "permission denied",
            "quota",
            "billing",
            "exceeded your current quota",
            "token was rejected",
        )
    )


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
    started_pairs = 0
    active_pairs = 0
    progress_lock = asyncio.Lock()
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
        task_uses_judge = bool(_get_llm_metrics_for_task(task_type) or task_type == "rag")
        judge_metrics_enabled = False
        judge_skip_reason: str | None = None

        # ── update status ──
        start_time = datetime.now(timezone.utc)
        run.timestamp = start_time
        run.status = "running"
        run.config_json = {**config}
        db.commit()

        await q.put({"type": "status", "status": "running", "done": False})

        if task_uses_judge:
            judge_session = SessionLocal()
            try:
                configured_judge_enabled = judge_is_enabled(judge_session)
                configured_judge_model = get_judge_model_name(judge_session)
                judge_client, judge_model_name, judge_anthropic, judge_error = get_judge_client(judge_session)
            finally:
                judge_session.close()

            if configured_judge_enabled and configured_judge_model and judge_error:
                judge_skip_reason = judge_error
            elif configured_judge_enabled and configured_judge_model and (judge_client or judge_anthropic):
                judge_metrics_enabled = True
            elif configured_judge_enabled and configured_judge_model:
                judge_skip_reason = f"Judge model '{configured_judge_model}' is not ready, so judge metrics will be skipped for this run."
            else:
                judge_skip_reason = "LLM-as-Judge is off or no judge model is selected, so judge metrics will be skipped for this run."

            if judge_skip_reason:
                logger.info(judge_skip_reason)
                await q.put({"type": "info", "message": judge_skip_reason, "done": False})

        active_task_metrics = _get_metrics_for_run(task_type, judge_metrics_enabled)

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

        total = (len(models) + len(cloud_model_names)) * len(items)
        completed = 0
        semaphore = asyncio.Semaphore(CONCURRENCY)
        run.config_json = {
            **(run.config_json or {}),
            "totalPairs": total,
            "completedPairs": 0,
            "startedPairs": 0,
            "activePairs": 0,
            "errorCount": 0,
            "retryCount": 0,
            "cacheHits": 0,
            "judgeSkipped": task_uses_judge and not judge_metrics_enabled,
            "judgeSkipReason": judge_skip_reason,
            "progressPhase": "warming_up",
            "progressMessage": "Preparing models, datasets, and scorers.",
        }
        db.commit()

        await q.put({"type": "start", "total": total, "done": False})

        async def emit_progress(
            *,
            model: str | None = None,
            phase: str | None = None,
            message: str | None = None,
            started_delta: int = 0,
            active_delta: int = 0,
            completed_delta: int = 0,
        ) -> None:
            nonlocal started_pairs, active_pairs, completed
            async with progress_lock:
                started_pairs = max(0, started_pairs + started_delta)
                active_pairs = max(0, active_pairs + active_delta)
                completed = max(0, completed + completed_delta)
                progress_db: Session = SessionLocal()
                try:
                    progress_run = progress_db.query(db_models.EvalRun).filter_by(id=run_id).first()
                    if progress_run and not is_terminal_status(progress_run.status):
                        progress_config = dict(progress_run.config_json or {})
                        progress_config["totalPairs"] = total
                        progress_config["completedPairs"] = completed
                        progress_config["startedPairs"] = started_pairs
                        progress_config["activePairs"] = active_pairs
                        progress_config["errorCount"] = pair_failures
                        progress_config["retryCount"] = retry_count
                        progress_config["cacheHits"] = cache_hits
                        if phase is not None:
                            progress_config["progressPhase"] = phase
                        if message is not None:
                            progress_config["progressMessage"] = message
                        if model is not None:
                            progress_config["currentModel"] = model
                        progress_run.config_json = progress_config
                        progress_db.commit()
                finally:
                    progress_db.close()
                pct = round(completed / total * 100) if total else 100
                await q.put({
                    "type": "progress",
                    "completed": completed,
                    "started": started_pairs,
                    "active": active_pairs,
                    "total": total,
                    "percent": pct,
                    "model": model,
                    "phase": phase,
                    "message": message,
                    "done": False,
                })

        # Warn once if BERTScore is expected but unavailable for this task
        if task_type == "summarization" and not bertscore.is_available():
            logger.warning(
                "BERTScore is in TASK_METRICS for summarization but bert_score is not available. "
                "bertscore_f1 will be absent from this run's results. "
                "To enable: pip install bert-score"
            )

        if task_type == "summarization":
            bertscore_state = bertscore.readiness_state()
            if bertscore_state == "download_required":
                await emit_progress(
                    phase="warming_up",
                    message="BERTScore is preparing for first use. The first summarization run can take longer.",
                )
                await q.put({
                    "type": "warning",
                    "message": "BERTScore may download a large model on first use (~400MB). This is a one-time download.",
                    "done": False,
                })
            elif bertscore_state == "ready":
                await emit_progress(
                    phase="warming_up",
                    message="BERTScore is ready. Starting summarization pairs.",
                )
                await q.put({
                    "type": "info",
                    "message": "BERTScore is already downloaded and ready for this run.",
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
                    await emit_progress(
                        model=model.name,
                        phase="running",
                        message=f"{model.name} started item {item.id}.",
                        started_delta=1,
                        active_delta=1,
                    )

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
                        result, cache_hit_count = await _generate_local_attempt(db_local, model.name, item.input)
                        cache_hits += cache_hit_count
                        retry_count += int(result.get("retries", 0))

                        if not result.get("ok"):
                            # Inference failed — record an error for every expected metric
                            err_msg = result.get("error", "Inference failed")
                            pair_failures += 1
                            for metric_name in active_task_metrics:
                                results_to_save.append(dict(
                                    run_id=run_id, model_id=model.id,
                                    metric_name=metric_name, score=0.0, error=True,
                                    raw_output=err_msg, item_id=item.id,
                                ))
                        else:
                            prediction = result.get("response", "")
                            display_prediction = prediction

                            # Traditional metrics (TASK_METRICS-aligned, no cross-task leakage)
                            item_scores = await asyncio.to_thread(
                                _score, task_type, prediction, item.expected_output, result
                            )

                            # Code execution scoring (Pass@1 / Pass@3)
                            if task_type == "code" and item.context:
                                try:
                                    ctx = json.loads(item.context)
                                    tests = ctx.get("tests")
                                    if tests:
                                        code_predictions = [prediction]
                                        generation_errors: list[str] = []
                                        for attempt_index in range(1, CODE_MAX_ATTEMPTS):
                                            extra_result, extra_cache_hit_count = await _generate_local_attempt(
                                                db_local,
                                                model.name,
                                                item.input,
                                                attempt_index=attempt_index,
                                            )
                                            cache_hits += extra_cache_hit_count
                                            retry_count += int(extra_result.get("retries", 0))
                                            if not extra_result.get("ok"):
                                                generation_errors.append(
                                                    f"Attempt {attempt_index + 1} generation failed: {extra_result.get('error', 'Inference failed')}"
                                                )
                                                break
                                            code_predictions.append(extra_result.get("response", ""))

                                        attempt_scores = await asyncio.to_thread(
                                            code_exec.evaluate_attempts,
                                            code_predictions,
                                            tests,
                                        )
                                        item_scores["pass_at_1"] = attempt_scores[0][0] if attempt_scores else 0.0
                                        item_scores["pass_at_3"] = 1.0 if any(score >= 1.0 for score, _ in attempt_scores[:3]) else 0.0
                                        passing_index = next(
                                            (idx for idx, (score, _) in enumerate(attempt_scores) if score >= 1.0),
                                            None,
                                        )
                                        if passing_index is not None and passing_index < len(code_predictions):
                                            display_prediction = code_predictions[passing_index]
                                        display_prediction = (
                                            f"{display_prediction}\n\n"
                                            f"{_format_code_attempt_summary(attempt_scores, generation_errors, passing_index or 0)}"
                                        )
                                except Exception:
                                    pass

                            for metric_name, score_value in item_scores.items():
                                results_to_save.append(dict(
                                    run_id=run_id, model_id=model.id,
                                    metric_name=metric_name, score=float(score_value), error=False,
                                    raw_output=display_prediction[:2000], item_id=item.id,
                                ))

                            # LLM-as-Judge metrics
                            llm_metrics = _get_llm_metrics_for_task(task_type) if judge_metrics_enabled else []
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

                            # RAG judge metrics (context_relevance + faithfulness)
                            if task_type == "rag" and judge_metrics_enabled:
                                rag_scores = rag_scoring.compute_rag_metrics_with_rationale(
                                    question=item.input,
                                    context=item.context or "",
                                    answer=prediction,
                                    client=judge_client,
                                    anthropic_client=judge_anthropic,
                                    model=judge_model_name or "",
                                )
                                for metric_name, payload in rag_scores.items():
                                    results_to_save.append(dict(
                                        run_id=run_id, model_id=model.id,
                                        metric_name=metric_name,
                                        score=float(payload.get("score", 0.0)),
                                        error=False,
                                        raw_output=f"{prediction[:1500]}\n\n--- Judge Rationale ---\n{payload.get('rationale', '')}",
                                        item_id=item.id,
                                    ))

                    # ── Bulk insert all results for this (model, item) pair — one commit ──
                    for r in results_to_save:
                        db_local.add(db_models.EvalResult(**r))
                    db_local.commit()

                except Exception as e:
                    db_local.rollback()
                    pair_failures += 1
                    error_message = str(e)
                    failure_messages.append(f"{model.name} / item {item.id}: {error_message}")
                    try:
                        _persist_error_rows(
                            db_local,
                            run_id=run_id,
                            model_id=model.id,
                            task_type=task_type,
                            item_id=item.id,
                            message=error_message,
                            metrics=active_task_metrics,
                        )
                    except Exception:
                        db_local.rollback()
                    await q.put({"type": "error", "message": error_message, "done": False})
                finally:
                    db_local.close()

                await emit_progress(
                    model=model.name,
                    phase="running",
                    message=f"{model.name} finished item {item.id}.",
                    active_delta=-1,
                    completed_delta=1,
                )

        # Launch all (model, item) pairs; semaphore bounds concurrency
        tasks = [eval_pair(model, item) for model in models for item in items]
        await asyncio.gather(*tasks)

        # ── Cloud model inference (via configured OpenAI-compatible / Anthropic client) ──
        if cloud_model_names:
            for cloud_model_name in cloud_model_names:
                fatal_cloud_error: str | None = None
                setup_session = SessionLocal()
                try:
                    cloud_client, invocation_model, cloud_anthropic, setup_error = get_model_client(setup_session, cloud_model_name)
                    virtual_model = setup_session.query(db_models.Model).filter_by(name=cloud_model_name).first()
                    if not virtual_model:
                        virtual_model = db_models.Model(
                            name=cloud_model_name,
                            size_gb=0,
                            family="cloud",
                            params="unknown",
                            quantization="none",
                        )
                        setup_session.add(virtual_model)
                        setup_session.commit()
                        setup_session.refresh(virtual_model)
                    virtual_model_id = virtual_model.id
                finally:
                    setup_session.close()

                if setup_error or (not cloud_client and not cloud_anthropic):
                    pair_failures += len(items)
                    failure_messages.append(f"{cloud_model_name}: {setup_error or 'No client available'}")
                    logger.warning(f"Cloud model inference skipped for {cloud_model_name}: {setup_error or 'No client available'}")
                    for item in items:
                        db_session = SessionLocal()
                        try:
                            for metric_name in active_task_metrics:
                                storage.save_eval_result(
                                    db_session,
                                    run.id,
                                    virtual_model_id,
                                    metric_name,
                                    0.0,
                                    raw_output=setup_error or "Cloud model client unavailable",
                                    error=True,
                                    item_id=item.id,
                                )
                        finally:
                            db_session.close()
                        await emit_progress(
                            model=cloud_model_name,
                            phase="failed",
                            message=f"{cloud_model_name} setup failed. Skipping item {item.id}.",
                            started_delta=1,
                            completed_delta=1,
                        )
                    continue

                for item in items:
                    status_session = SessionLocal()
                    try:
                        current_run = status_session.query(db_models.EvalRun).filter_by(id=run_id).first()
                        if not current_run or current_run.status == "cancel_requested":
                            break
                    finally:
                        status_session.close()
                    await emit_progress(
                        model=cloud_model_name,
                        phase="running",
                        message=f"{cloud_model_name} started item {item.id}.",
                        started_delta=1,
                        active_delta=1,
                    )
                    if fatal_cloud_error:
                        pair_failures += 1
                        db_session = SessionLocal()
                        try:
                            _persist_error_rows(
                                db_session,
                                run_id=run.id,
                                model_id=virtual_model_id,
                                task_type=task_type,
                                item_id=item.id,
                                message=fatal_cloud_error,
                                metrics=active_task_metrics,
                            )
                        finally:
                            db_session.close()
                        await emit_progress(
                            model=cloud_model_name,
                            phase="failed",
                            message=f"{cloud_model_name} skipped item {item.id} after a provider rejection.",
                            active_delta=-1,
                            completed_delta=1,
                        )
                        continue
                    try:
                        if task_type == "embedding":
                            if cloud_anthropic:
                                raise RuntimeError("Anthropic models do not expose an embeddings API for EvalBench.")

                            context = json.loads(item.context or "{}") if item.context else {}
                            candidates = context.get("candidates", [])
                            answer_index = context.get("answer_index", 0)
                            query_resp = _embedding_with_fallback(
                                cloud_client,
                                model=invocation_model or cloud_model_name,
                                input_text=item.input,
                            )
                            query_vec = query_resp.data[0].embedding if getattr(query_resp, "data", None) else []

                            candidate_vecs = []
                            for candidate in candidates:
                                candidate_resp = _embedding_with_fallback(
                                    cloud_client,
                                    model=invocation_model or cloud_model_name,
                                    input_text=candidate,
                                )
                                candidate_vecs.append(candidate_resp.data[0].embedding if getattr(candidate_resp, "data", None) else [])

                            item_scores = embeddings.compute_embedding_metrics(query_vec, candidate_vecs, answer_index)
                            ranked, sims = embeddings.rank_by_similarity(query_vec, candidate_vecs)
                            top_idx = ranked[0] if ranked else None
                            top_match = candidates[top_idx] if top_idx is not None and top_idx < len(candidates) else None
                            raw_output = json.dumps({
                                "top_match": top_match,
                                "top_similarity": sims[top_idx] if top_idx is not None else None,
                                "ranked_indices": ranked,
                            })

                            db_session = SessionLocal()
                            try:
                                for metric_name, score_val in item_scores.items():
                                    storage.save_eval_result(
                                        db_session,
                                        run.id,
                                        virtual_model_id,
                                        metric_name,
                                        float(score_val),
                                        raw_output=raw_output[:2000],
                                        item_id=item.id,
                                    )
                            finally:
                                db_session.close()
                        else:
                            resp, prediction, elapsed_seconds = await _generate_cloud_attempt(
                                client=cloud_client,
                                anthropic_client=cloud_anthropic,
                                model_name=invocation_model or cloud_model_name,
                                prompt=item.input,
                            )
                            display_prediction = prediction

                            try:
                                scores = _score(task_type, prediction, item.expected_output or "", {})
                            except Exception as exc:
                                logger.warning(f"Cloud scoring fallback triggered for {cloud_model_name} item {item.id}: {exc}")
                                scores = {}
                            scores.update(speed.compute_api_usage(resp, elapsed_seconds))

                            if task_type == "code" and item.context:
                                try:
                                    ctx = json.loads(item.context)
                                    tests = ctx.get("tests")
                                    if tests:
                                        code_predictions = [prediction]
                                        generation_errors: list[str] = []
                                        for attempt_index in range(1, CODE_MAX_ATTEMPTS):
                                            try:
                                                _, extra_prediction, _ = await _generate_cloud_attempt(
                                                    client=cloud_client,
                                                    anthropic_client=cloud_anthropic,
                                                    model_name=invocation_model or cloud_model_name,
                                                    prompt=item.input,
                                                    attempt_index=attempt_index,
                                                )
                                                code_predictions.append(extra_prediction)
                                            except Exception as exc:
                                                generation_errors.append(
                                                    f"Attempt {attempt_index + 1} generation failed: {exc}"
                                                )
                                                break

                                        attempt_scores = await asyncio.to_thread(
                                            code_exec.evaluate_attempts,
                                            code_predictions,
                                            tests,
                                        )
                                        scores["pass_at_1"] = attempt_scores[0][0] if attempt_scores else 0.0
                                        scores["pass_at_3"] = 1.0 if any(score >= 1.0 for score, _ in attempt_scores[:3]) else 0.0
                                        passing_index = next(
                                            (idx for idx, (score, _) in enumerate(attempt_scores) if score >= 1.0),
                                            None,
                                        )
                                        if passing_index is not None and passing_index < len(code_predictions):
                                            display_prediction = code_predictions[passing_index]
                                        display_prediction = (
                                            f"{display_prediction}\n\n"
                                            f"{_format_code_attempt_summary(attempt_scores, generation_errors, passing_index or 0)}"
                                        )
                                except Exception as exc:
                                    logger.warning(f"Cloud code execution scoring failed for {cloud_model_name} item {item.id}: {exc}")

                            llm_metrics = _get_llm_metrics_for_task(task_type) if judge_metrics_enabled else []
                            db_session = SessionLocal()
                            try:
                                for metric_name, score_val in scores.items():
                                    storage.save_eval_result(
                                        db_session, run.id, virtual_model_id,
                                        metric_name, score_val,
                                        raw_output=display_prediction[:2000],
                                        item_id=item.id,
                                    )
                                for metric_name in llm_metrics:
                                    llm_score, rationale = evaluate_with_llm(
                                        db_session,
                                        metric_name,
                                        item.input,
                                        prediction,
                                        item.context or "",
                                    )
                                    storage.save_eval_result(
                                        db_session, run.id, virtual_model_id,
                                        metric_name, float(llm_score),
                                        raw_output=f"{prediction[:1500]}\n\n--- Judge Rationale ---\n{rationale}",
                                        item_id=item.id,
                                    )
                                if task_type == "rag" and judge_metrics_enabled:
                                    rag_scores = rag_scoring.compute_rag_metrics_with_rationale(
                                        question=item.input,
                                        context=item.context or "",
                                        answer=prediction,
                                        client=judge_client,
                                        anthropic_client=judge_anthropic,
                                        model=judge_model_name or "",
                                    )
                                    for metric_name, payload in rag_scores.items():
                                        storage.save_eval_result(
                                            db_session,
                                            run.id,
                                            virtual_model_id,
                                            metric_name,
                                            float(payload.get("score", 0.0)),
                                            raw_output=f"{prediction[:1500]}\n\n--- Judge Rationale ---\n{payload.get('rationale', '')}",
                                            item_id=item.id,
                                        )
                            finally:
                                db_session.close()
                    except Exception as e:
                        pair_failures += 1
                        error_message = str(e)
                        failure_messages.append(f"{cloud_model_name} / item {item.id}: {error_message}")
                        logger.warning(f"Cloud model inference failed for item {item.id}: {error_message}")
                        db_session = SessionLocal()
                        try:
                            _persist_error_rows(
                                db_session,
                                run_id=run.id,
                                model_id=virtual_model_id,
                                task_type=task_type,
                                item_id=item.id,
                                message=error_message,
                                metrics=active_task_metrics,
                            )
                        finally:
                            db_session.close()
                        if _is_permanent_provider_error(error_message):
                            fatal_cloud_error = error_message
                            failure_messages.append(
                                f"{cloud_model_name}: stopping remaining items after provider rejection"
                            )
                            await q.put({
                                "type": "warning",
                                "message": f"{cloud_model_name} was rejected by the provider. Remaining items for that model were skipped.",
                                "done": False,
                            })
                    finally:
                        await emit_progress(
                            model=cloud_model_name,
                            phase="running",
                            message=f"{cloud_model_name} finished item {item.id}.",
                            active_delta=-1,
                            completed_delta=1,
                        )

        db.refresh(run)
        duration_seconds = (datetime.now(timezone.utc) - (start_time or datetime.now(timezone.utc))).total_seconds()
        updated_config = dict(config)
        updated_config["durationSeconds"] = round(duration_seconds, 2)
        updated_config["totalPairs"] = total
        updated_config["completedPairs"] = completed
        updated_config["startedPairs"] = started_pairs
        updated_config["activePairs"] = active_pairs
        updated_config["retryCount"] = retry_count
        updated_config["cacheHits"] = cache_hits
        updated_config["successfulPairs"] = max(0, completed - pair_failures)
        updated_config["completedWithErrors"] = pair_failures > 0 and completed > pair_failures
        updated_config["progressPhase"] = "finished"
        updated_config["progressMessage"] = "Run finished."
        if pair_failures:
            updated_config["errorCount"] = pair_failures
            updated_config["errors"] = failure_messages[:10]
        run.config_json = updated_config
        if run.status == "cancel_requested":
            run.status = "cancelled"
        else:
            run.status = "completed" if completed > pair_failures else "failed"
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
                    duration_seconds = (datetime.now(timezone.utc) - start_time).total_seconds()
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
