import os
import httpx
from typing import Any

OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://localhost:11434")


async def check_status() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{OLLAMA_BASE}/api/tags", timeout=3.0)
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
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{OLLAMA_BASE}/api/generate",
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
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{OLLAMA_BASE}/api/embeddings",
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
