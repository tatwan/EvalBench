from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import GoldenDatasetOut
from backend.services import storage

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=list[GoldenDatasetOut])
def list_datasets(db: Session = Depends(get_db)):
    datasets = storage.get_all_datasets(db)
    return [GoldenDatasetOut.model_validate(d) for d in datasets]
