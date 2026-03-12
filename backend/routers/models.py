from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import ModelOut
from backend.services import storage
from backend.services.ollama import list_models

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelOut])
def get_models(db: Session = Depends(get_db)):
    models = storage.get_all_models(db)
    return [ModelOut.model_validate(m) for m in models]


@router.post("/discover", response_model=list[ModelOut])
async def discover_models(db: Session = Depends(get_db)):
    ollama_models = await list_models()
    models = storage.upsert_models_from_ollama(db, ollama_models)
    return [ModelOut.model_validate(m) for m in models]
