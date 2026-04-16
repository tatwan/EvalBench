import asyncio
import shutil
import subprocess

from fastapi import APIRouter, HTTPException
from backend.schemas import OllamaStatusOut
from backend.services.ollama import check_status

router = APIRouter(prefix="/api/ollama", tags=["ollama"])


@router.get("/status", response_model=OllamaStatusOut)
async def ollama_status():
    result = await check_status()
    return OllamaStatusOut(
        running=result["ok"],
        model_count=result["model_count"],
        error=result.get("error"),
    )


@router.post("/start")
async def start_ollama():
    current = await check_status()
    if current["ok"]:
        return {"ok": True, "message": "Ollama is already running.", "running": True}

    ollama_path = shutil.which("ollama")
    if not ollama_path:
        raise HTTPException(status_code=400, detail="Ollama is not installed or not on PATH.")

    try:
        subprocess.Popen(
            [ollama_path, "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start Ollama: {exc}") from exc

    for _ in range(10):
        await asyncio.sleep(0.5)
        status = await check_status()
        if status["ok"]:
            return {"ok": True, "message": "Ollama started successfully.", "running": True}

    return {
        "ok": False,
        "message": "Ollama was started, but it is not reachable yet. Give it a moment and try again.",
        "running": False,
    }
