"""
Speed metrics — extracted from Ollama's generate response fields.
No external dependencies required; Ollama returns these on every call.
"""
from typing import Any


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
