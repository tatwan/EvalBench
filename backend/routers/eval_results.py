from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services import storage
from backend.schemas import EvalResultOut

router = APIRouter(prefix="/api/eval-results", tags=["eval-results"])


@router.get("", response_model=list[EvalResultOut])
def list_eval_results(db: Session = Depends(get_db)):
    return storage.get_all_eval_results(db)
