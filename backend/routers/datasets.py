from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import (
    GoldenDatasetCreate,
    GoldenDatasetDetailOut,
    GoldenDatasetImport,
    GoldenDatasetImportPreviewOut,
    GoldenDatasetOut,
    GoldenItemOut,
)
from backend.services import dataset_importer, storage

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def _is_user_dataset(source: str | None) -> bool:
    normalized = (source or "").strip().lower()
    return normalized.startswith(("manual", "import", "upload", "template:"))


@router.get("", response_model=list[GoldenDatasetOut])
def list_datasets(db: Session = Depends(get_db)):
    datasets = storage.get_all_datasets(db)
    counts = storage.get_dataset_item_counts(db)
    return [
        GoldenDatasetOut.model_validate(
            {
                "id": dataset.id,
                "name": dataset.name,
                "source": dataset.source,
                "created_at": dataset.created_at,
                "schema_version": dataset.schema_version,
                "item_count": counts.get(dataset.id, 0),
            }
        )
        for dataset in datasets
    ]


@router.post("/import-preview", response_model=GoldenDatasetImportPreviewOut)
def preview_dataset_import(payload: GoldenDatasetImport):
    try:
        items = dataset_importer.parse_dataset_import(payload.format, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    preview = items[:5]
    return GoldenDatasetImportPreviewOut.model_validate(
        {
            "count": len(items),
            "items": preview,
        }
    )


@router.post("", response_model=GoldenDatasetDetailOut, status_code=201)
def create_dataset(payload: GoldenDatasetCreate, db: Session = Depends(get_db)):
    dataset = storage.create_dataset(
        db,
        name=payload.name.strip(),
        source=payload.source.strip() if payload.source else "manual",
        items=[item.model_dump() for item in payload.items],
    )
    items = storage.get_dataset_items(db, dataset.id)
    return GoldenDatasetDetailOut.model_validate(
        {
            "id": dataset.id,
            "name": dataset.name,
            "source": dataset.source,
            "created_at": dataset.created_at,
            "schema_version": dataset.schema_version,
            "item_count": len(items),
            "items": [GoldenItemOut.model_validate(item) for item in items],
        }
    )


@router.post("/import", response_model=GoldenDatasetDetailOut, status_code=201)
def import_dataset(payload: GoldenDatasetImport, db: Session = Depends(get_db)):
    try:
        items = dataset_importer.parse_dataset_import(payload.format, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    source = payload.source.strip() if payload.source else f"import:{payload.format}"
    dataset = storage.create_dataset(
        db,
        name=payload.name.strip(),
        source=source,
        items=items,
    )
    persisted_items = storage.get_dataset_items(db, dataset.id)
    return GoldenDatasetDetailOut.model_validate(
        {
            "id": dataset.id,
            "name": dataset.name,
            "source": dataset.source,
            "created_at": dataset.created_at,
            "schema_version": dataset.schema_version,
            "item_count": len(persisted_items),
            "items": [GoldenItemOut.model_validate(item) for item in persisted_items],
        }
    )


@router.get("/{dataset_id}", response_model=GoldenDatasetDetailOut)
def get_dataset(dataset_id: int, db: Session = Depends(get_db)):
    dataset = storage.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    items = storage.get_dataset_items(db, dataset_id)
    return GoldenDatasetDetailOut.model_validate(
        {
            "id": dataset.id,
            "name": dataset.name,
            "source": dataset.source,
            "created_at": dataset.created_at,
            "schema_version": dataset.schema_version,
            "item_count": len(items),
            "items": [GoldenItemOut.model_validate(item) for item in items],
        }
    )


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    dataset = storage.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if not _is_user_dataset(dataset.source):
        raise HTTPException(status_code=400, detail="Built-in datasets cannot be deleted.")

    if storage.dataset_has_results(db, dataset_id):
        raise HTTPException(
            status_code=400,
            detail="This dataset has already been used in an evaluation run and cannot be deleted without losing run history.",
        )

    deleted = storage.delete_dataset(db, dataset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return {"id": dataset_id, "name": dataset.name}
