from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from backend import models as db_models

BUILT_IN_DATASET_BASELINES: dict[str, int] = {
    "EvalBench Summarization v1": 1,
    "EvalBench QA v1": 1,
    "EvalBench MMLU (Subset)": 1,
    "EvalBench MMLU (Expanded v2)": 2,
    "EvalBench HellaSwag (Subset)": 1,
    "EvalBench ARC (Subset)": 1,
    "EvalBench BoolQ (Subset)": 1,
    "EvalBench CommonsenseQA (Subset)": 1,
    "EvalBench GSM8K (Subset)": 1,
    "EvalBench TruthfulQA (Subset)": 1,
    "EvalBench TruthfulQA (MC v2)": 2,
    "EvalBench Embeddings v1": 1,
    "EvalBench HumanEval (Subset)": 1,
    "EvalBench Classification v1": 1,
    "EvalBench Translation v1": 1,
    "EvalBench RAG v1": 1,
}


# ─── Models ────────────────────────────────────────────────

def get_all_models(db: Session) -> list[db_models.Model]:
    return db.query(db_models.Model).all()


def upsert_models_from_ollama(db: Session, ollama_models: list[dict]) -> list[db_models.Model]:
    """Sync models from Ollama into the DB (insert if new, skip if exists)."""
    for m in ollama_models:
        name = m.get("name", "")
        existing = db.query(db_models.Model).filter_by(name=name).first()
        if not existing:
            details = m.get("details", {})
            size_bytes = m.get("size", 0)
            new_model = db_models.Model(
                name=name,
                family=details.get("family"),
                params=details.get("parameter_size"),
                quantization=details.get("quantization_level"),
                size_gb=round(size_bytes / 1_000_000_000, 2) if size_bytes else None,
            )
            db.add(new_model)
            # Also initialise ELO rating
            db.flush()  # get the new model id
            elo = db_models.EloRating(model_id=new_model.id, rating=1200, games_played=0)
            db.add(elo)
    # ── Cleanup stale models ──
    # If a model was deleted from Ollama, remove it from the DB if it has no foreign key references.
    active_names = {m.get("name", "") for m in ollama_models}
    all_models = db.query(db_models.Model).all()
    for model in all_models:
        if model.name not in active_names:
            has_results = db.query(db_models.EvalResult).filter_by(model_id=model.id).first() is not None
            has_battles = db.query(db_models.ArenaBattle).filter(
                (db_models.ArenaBattle.model_a_id == model.id) | 
                (db_models.ArenaBattle.model_b_id == model.id)
            ).first() is not None
            if not has_results and not has_battles:
                db.query(db_models.EloRating).filter_by(model_id=model.id).delete()
                db.delete(model)

    db.commit()
    return get_all_models(db)


# ─── Arena ────────────────────────────────────────────────

def get_random_model_pair(db: Session) -> tuple[db_models.Model, db_models.Model] | None:
    models = db.query(db_models.Model).filter(
        ~db_models.Model.name.ilike("%embed%"),
        or_(db_models.Model.family.is_(None), db_models.Model.family != "cloud"),
    ).order_by(func.random()).limit(2).all()
    if len(models) < 2:
        return None
    return models[0], models[1]


def get_model_pair_by_ids(
    db: Session,
    model_a_id: int,
    model_b_id: int,
) -> tuple[db_models.Model, db_models.Model] | None:
    if model_a_id == model_b_id:
        return None
    models = (
        db.query(db_models.Model)
        .filter(db_models.Model.id.in_([model_a_id, model_b_id]))
        .all()
    )
    if len(models) != 2:
        return None
    model_map = {model.id: model for model in models}
    model_a = model_map.get(model_a_id)
    model_b = model_map.get(model_b_id)
    if not model_a or not model_b:
        return None
    if model_a.family == "cloud" or model_b.family == "cloud":
        return None
    if "embed" in model_a.name.lower() or "embed" in model_b.name.lower():
        return None
    return model_a, model_b


def record_arena_battle(
    db: Session,
    model_a_id: int,
    model_b_id: int,
    prompt: str,
    winner: str,
) -> db_models.ArenaBattle:
    battle = db_models.ArenaBattle(
        model_a_id=model_a_id,
        model_b_id=model_b_id,
        prompt=prompt,
        winner=winner,
        timestamp=datetime.utcnow(),
    )
    db.add(battle)
    db.commit()
    db.refresh(battle)
    _update_elo(db, model_a_id, model_b_id, winner)
    return battle


def _update_elo(db: Session, model_a_id: int, model_b_id: int, winner: str):
    def get_or_create_elo(model_id: int) -> db_models.EloRating:
        elo = db.query(db_models.EloRating).filter_by(model_id=model_id).first()
        if not elo:
            elo = db_models.EloRating(model_id=model_id, rating=1200, games_played=0)
            db.add(elo)
            db.flush()
        return elo

    def _dynamic_k(games: int) -> int:
        """Return ELO K-factor based on career game count (pre-increment).
        New models (< 10 games) converge quickly; established models (>= 30) are stable."""
        if games < 10:
            return 64
        if games < 30:
            return 32
        return 16

    elo_a = get_or_create_elo(model_a_id)
    elo_b = get_or_create_elo(model_b_id)

    expected_a = 1 / (1 + 10 ** ((elo_b.rating - elo_a.rating) / 400))
    expected_b = 1 - expected_a

    if winner == "model_a":
        actual_a, actual_b = 1.0, 0.0
    elif winner == "model_b":
        actual_a, actual_b = 0.0, 1.0
    else:  # tie
        actual_a, actual_b = 0.5, 0.5

    elo_a.rating = round(elo_a.rating + _dynamic_k(elo_a.games_played) * (actual_a - expected_a))
    elo_b.rating = round(elo_b.rating + _dynamic_k(elo_b.games_played) * (actual_b - expected_b))
    elo_a.games_played += 1
    elo_b.games_played += 1
    elo_a.last_updated = datetime.utcnow()
    elo_b.last_updated = datetime.utcnow()
    db.commit()


def get_arena_leaderboard(db: Session) -> list[dict]:
    rows = (
        db.query(db_models.EloRating, db_models.Model)
        .join(db_models.Model, db_models.EloRating.model_id == db_models.Model.id)
        .order_by(db_models.EloRating.rating.desc())
        .all()
    )
    return [{"elo": elo, "model": model} for elo, model in rows]


# ─── Eval Runs ────────────────────────────────────────────

def get_all_eval_runs(db: Session) -> list[db_models.EvalRun]:
    return db.query(db_models.EvalRun).order_by(db_models.EvalRun.timestamp.desc()).all()


def create_eval_run(db: Session, config: dict) -> db_models.EvalRun:
    run = db_models.EvalRun(
        config_json=config,
        status="pending",
        timestamp=datetime.utcnow(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_eval_run(db: Session, run_id: int) -> db_models.EvalRun | None:
    return db.query(db_models.EvalRun).filter_by(id=run_id).first()


def get_eval_results(db: Session, run_id: int) -> list[db_models.EvalResult]:
    return db.query(db_models.EvalResult).filter_by(run_id=run_id).all()

def get_all_eval_results(db: Session) -> list[db_models.EvalResult]:
    return db.query(db_models.EvalResult).all()


def save_eval_result(
    db: Session,
    run_id: int,
    model_id: int,
    metric_name: str,
    score: float,
    raw_output: str | None = None,
    error: bool = False,
    item_id: int | None = None,
) -> db_models.EvalResult:
    result = db_models.EvalResult(
        run_id=run_id,
        model_id=model_id,
        metric_name=metric_name,
        score=score,
        error=error,
        raw_output=raw_output,
        item_id=item_id,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


def update_eval_run_status(db: Session, run_id: int, status: str):
    run = db.query(db_models.EvalRun).filter_by(id=run_id).first()
    if run:
        run.status = status
        db.commit()
        db.refresh(run)
    return run


# ─── Datasets ─────────────────────────────────────────────

def get_all_datasets(db: Session) -> list[db_models.GoldenDataset]:
    return (
        db.query(db_models.GoldenDataset)
        .order_by(db_models.GoldenDataset.created_at.desc(), db_models.GoldenDataset.id.desc())
        .all()
    )


def get_dataset(db: Session, dataset_id: int) -> db_models.GoldenDataset | None:
    return db.query(db_models.GoldenDataset).filter_by(id=dataset_id).first()


def normalized_dataset_source(name: str, source: str | None, schema_version: int | None) -> str | None:
    if source is None:
        return source
    normalized = source.strip().lower()
    if normalized != "curated-inline":
        return source

    baseline_version = BUILT_IN_DATASET_BASELINES.get(name)
    if baseline_version is None:
        return "manual:derived"
    if (schema_version or 1) > baseline_version:
        return "manual:derived"
    return "curated-inline"


def is_builtin_dataset_record(dataset: db_models.GoldenDataset) -> bool:
    return normalized_dataset_source(dataset.name, dataset.source, dataset.schema_version) == "curated-inline"


def repair_legacy_dataset_sources(db: Session) -> None:
    dirty = False
    for dataset in db.query(db_models.GoldenDataset).all():
        normalized = normalized_dataset_source(dataset.name, dataset.source, dataset.schema_version)
        if normalized != dataset.source:
            dataset.source = normalized
            dirty = True
    if dirty:
        db.commit()


def get_dataset_items(db: Session, dataset_id: int) -> list[db_models.GoldenItem]:
    return db.query(db_models.GoldenItem).filter_by(dataset_id=dataset_id).order_by(db_models.GoldenItem.id.asc()).all()


def get_dataset_item_counts(db: Session) -> dict[int, int]:
    rows = (
        db.query(
            db_models.GoldenItem.dataset_id,
            func.count(db_models.GoldenItem.id),
        )
        .group_by(db_models.GoldenItem.dataset_id)
        .all()
    )
    return {dataset_id: count for dataset_id, count in rows}


def create_dataset(
    db: Session,
    *,
    name: str,
    source: str | None,
    items: list[dict],
) -> db_models.GoldenDataset:
    existing_version = (
        db.query(func.max(db_models.GoldenDataset.schema_version))
        .filter(db_models.GoldenDataset.name == name)
        .scalar()
    )
    next_version = int(existing_version or 0) + 1

    dataset = db_models.GoldenDataset(
        name=name,
        source=source,
        schema_version=next_version,
    )
    db.add(dataset)
    db.flush()

    for item in items:
        db.add(
            db_models.GoldenItem(
                dataset_id=dataset.id,
                input=item["input"],
                expected_output=item["expected_output"],
                context=item.get("context"),
                tags=item.get("tags"),
                difficulty=item.get("difficulty"),
            )
        )

    db.commit()
    db.refresh(dataset)
    return dataset


def dataset_has_results(db: Session, dataset_id: int) -> bool:
    return (
        db.query(db_models.EvalResult.id)
        .join(db_models.GoldenItem, db_models.EvalResult.item_id == db_models.GoldenItem.id)
        .filter(db_models.GoldenItem.dataset_id == dataset_id)
        .first()
        is not None
    )


def delete_dataset(db: Session, dataset_id: int) -> db_models.GoldenDataset | None:
    dataset = get_dataset(db, dataset_id)
    if not dataset:
        return None

    db.query(db_models.GoldenItem).filter_by(dataset_id=dataset_id).delete()
    db.delete(dataset)
    db.commit()
    return dataset
