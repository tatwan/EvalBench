from fastapi import APIRouter
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
