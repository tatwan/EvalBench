import os
import asyncio
import httpx
from typing import Any

from backend.database import SessionLocal
from backend.models import Setting

# Module-level host cache — avoids a DB round-trip on every Ollama call.
# Invalidated by calling invalidate_host_cache() when settings are saved.
_cached_host: str | None = None
RETRY_DELAYS_S = (1.0, 2.0, 4.0)
RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}


def invalidate_host_cache() -> None:
    """Call this whenever ollama_host is updated in Settings."""
    global _cached_host
    _cached_host = None


def get_ollama_base() -> str:
    global _cached_host
    if _cached_host is not None:
        return _cached_host

    db = SessionLocal()
    try:
        setting = db.query(Setting).filter_by(key="ollama_host").first()
        if setting and setting.value:
            _cached_host = setting.value.rstrip("/")
            return _cached_host
    except Exception:
        pass
    finally:
        db.close()

    _cached_host = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    return _cached_host


async def check_status(base_url: str | None = None) -> dict[str, Any]:
    try:
        base = (base_url or get_ollama_base()).rstrip("/")
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{base}/api/tags", timeout=3.0)
            res.raise_for_status()
            data = res.json()
            models = data.get("models", [])
            return {"ok": True, "model_count": len(models), "models": models}
    except Exception as e:
        return {"ok": False, "model_count": 0, "models": [], "error": str(e)}


async def list_models() -> list[dict]:
    result = await check_status()
    return result["models"] if result["ok"] else []


def _is_retryable_error(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUS_CODES
    return isinstance(
        exc,
        (
            httpx.TimeoutException,
            httpx.ConnectError,
            httpx.ReadError,
            httpx.RemoteProtocolError,
            httpx.NetworkError,
        ),
    )


async def _post_with_retry(path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    base = get_ollama_base()
    attempts_allowed = len(RETRY_DELAYS_S) + 1
    last_error = "Unknown Ollama error"

    for attempt in range(1, attempts_allowed + 1):
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(f"{base}{path}", json=payload, timeout=timeout)
                res.raise_for_status()
                return {
                    "ok": True,
                    "data": res.json(),
                    "attempts": attempt,
                    "retries": attempt - 1,
                }
        except Exception as e:
            last_error = str(e)
            if attempt >= attempts_allowed or not _is_retryable_error(e):
                break
            await asyncio.sleep(RETRY_DELAYS_S[attempt - 1])

    return {
        "ok": False,
        "error": last_error,
        "attempts": attempts_allowed,
        "retries": attempts_allowed - 1,
    }


async def generate(model: str, prompt: str) -> dict[str, Any]:
    result = await _post_with_retry(
        "/api/generate",
        {
            "model": model, 
            "prompt": prompt, 
            "stream": False,
            "options": {"logprobs": True},  # Try standard options dictionary
            "logprobs": True                # Newer direct root key param
        },
        timeout=120.0,
    )
    if not result["ok"]:
        return {
            "ok": False,
            "error": result["error"],
            "attempts": result.get("attempts", 1),
            "retries": result.get("retries", 0),
        }

    data = result["data"]
    return {
        "ok": True,
        "response": data["response"],
        "attempts": result["attempts"],
        "retries": result["retries"],
        # Speed metrics — Ollama returns these for free
        "eval_count": data.get("eval_count"),
        "eval_duration": data.get("eval_duration"),
        "prompt_eval_count": data.get("prompt_eval_count"),
        "load_duration": data.get("load_duration"),
        "total_duration": data.get("total_duration"),
        # Logprobs if provided by the model version
        "logprobs": data.get("logprobs")
    }


async def embed(model: str, prompt: str) -> dict[str, Any]:
    result = await _post_with_retry(
        "/api/embeddings",
        {"model": model, "prompt": prompt},
        timeout=120.0,
    )
    if not result["ok"]:
        return {
            "ok": False,
            "error": result["error"],
            "attempts": result.get("attempts", 1),
            "retries": result.get("retries", 0),
        }

    data = result["data"]
    return {
        "ok": True,
        "embedding": data.get("embedding", []),
        "attempts": result["attempts"],
        "retries": result["retries"],
    }
