import os
import httpx
from typing import Any

from backend.database import SessionLocal
from backend.models import Setting

# Module-level host cache — avoids a DB round-trip on every Ollama call.
# Invalidated by calling invalidate_host_cache() when settings are saved.
_cached_host: str | None = None


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


async def check_status() -> dict[str, Any]:
    try:
        base = get_ollama_base()
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


async def generate(model: str, prompt: str) -> dict[str, Any]:
    try:
        base = get_ollama_base()
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{base}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
                timeout=120.0,
            )
            res.raise_for_status()
            data = res.json()
            return {
                "ok": True,
                "response": data["response"],
                # Speed metrics — Ollama returns these for free
                "eval_count": data.get("eval_count"),
                "eval_duration": data.get("eval_duration"),
                "prompt_eval_count": data.get("prompt_eval_count"),
                "load_duration": data.get("load_duration"),
                "total_duration": data.get("total_duration"),
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def embed(model: str, prompt: str) -> dict[str, Any]:
    try:
        base = get_ollama_base()
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{base}/api/embeddings",
                json={"model": model, "prompt": prompt},
                timeout=120.0,
            )
            res.raise_for_status()
            data = res.json()
            return {
                "ok": True,
                "embedding": data.get("embedding", []),
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}
