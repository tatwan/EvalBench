"""
Speed metrics — extracted from Ollama or cloud provider responses.
"""
from typing import Any


def _usage_value(usage: Any, *keys: str) -> int | None:
    if usage is None:
        return None
    for key in keys:
        if isinstance(usage, dict) and usage.get(key) is not None:
            return int(usage[key])
        value = getattr(usage, key, None)
        if value is not None:
            return int(value)
    return None


def compute(ollama_response: dict[str, Any]) -> dict[str, float]:
    """
    Compute speed metrics from a raw Ollama /api/generate response.

    Returns:
        tokens_per_second: generation throughput
        total_latency_s:   wall-clock time for the full response
        load_latency_s:    time to load the model into GPU/RAM
        prompt_tokens:     number of tokens in the input prompt
        output_tokens:     number of tokens generated
    """
    eval_count: int = ollama_response.get("eval_count") or 0
    eval_duration: int = ollama_response.get("eval_duration") or 0
    total_duration: int = ollama_response.get("total_duration") or 0
    load_duration: int = ollama_response.get("load_duration") or 0
    prompt_eval_count: int = ollama_response.get("prompt_eval_count") or 0

    tps = (eval_count / (eval_duration / 1e9)) if eval_duration > 0 else 0.0
    total_s = total_duration / 1e9
    load_s = load_duration / 1e9

    return {
        "tokens_per_second": round(tps, 2),
        "total_latency_s": round(total_s, 3),
        "load_latency_s": round(load_s, 3),
        "prompt_tokens": prompt_eval_count,
        "output_tokens": eval_count,
    }


def compute_api_usage(response: Any, elapsed_seconds: float) -> dict[str, float]:
    """
    Compute portable speed metrics from OpenAI-compatible / Anthropic responses.
    These APIs expose token usage but not model load time, so load_latency_s is omitted.
    """
    usage = response.get("usage") if isinstance(response, dict) else getattr(response, "usage", None)
    prompt_tokens = _usage_value(usage, "prompt_tokens", "input_tokens")
    output_tokens = _usage_value(usage, "completion_tokens", "output_tokens")
    total_s = max(0.0, float(elapsed_seconds or 0.0))

    metrics: dict[str, float] = {
        "total_latency_s": round(total_s, 3),
    }
    if prompt_tokens is not None:
        metrics["prompt_tokens"] = prompt_tokens
    if output_tokens is not None:
        metrics["output_tokens"] = output_tokens
        metrics["tokens_per_second"] = round((output_tokens / total_s) if total_s > 0 else 0.0, 2)
    return metrics
