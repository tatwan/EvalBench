import random
from datetime import datetime
from sqlalchemy.orm import Session
from backend import models as db_models


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
    db.commit()
    return get_all_models(db)


# ─── Arena ────────────────────────────────────────────────

def get_random_model_pair(db: Session) -> tuple[db_models.Model, db_models.Model] | None:
    models = db.query(db_models.Model).all()
    if len(models) < 2:
        return None
    pair = random.sample(models, 2)
    return pair[0], pair[1]


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
    K = 32

    def get_or_create_elo(model_id: int) -> db_models.EloRating:
        elo = db.query(db_models.EloRating).filter_by(model_id=model_id).first()
        if not elo:
            elo = db_models.EloRating(model_id=model_id, rating=1200, games_played=0)
            db.add(elo)
            db.flush()
        return elo

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

    elo_a.rating = round(elo_a.rating + K * (actual_a - expected_a))
    elo_b.rating = round(elo_b.rating + K * (actual_b - expected_b))
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
    item_id: int | None = None,
) -> db_models.EvalResult:
    result = db_models.EvalResult(
        run_id=run_id,
        model_id=model_id,
        metric_name=metric_name,
        score=score,
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


# ─── Datasets ─────────────────────────────────────────────

def get_all_datasets(db: Session) -> list[db_models.GoldenDataset]:
    return db.query(db_models.GoldenDataset).all()
