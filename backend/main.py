from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.database import engine, Base, SessionLocal
from backend.routers import ollama as ollama_router
from backend.routers import models as models_router
from backend.routers import arena as arena_router
from backend.routers import eval_runs as eval_runs_router
from backend.routers import eval_results as eval_results_router
from backend.routers import datasets as datasets_router
from backend.routers import settings as settings_router
from backend.services import dataset_seeder
from backend.services.ollama import list_models
from backend.services import storage
from backend.scoring import meteor as meteor_scoring
from backend import models as db_models
from sqlalchemy import text


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables (no-op if they already exist)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # DB Migration: Add error column if missing
        try:
            db.execute(text("ALTER TABLE eval_results ADD COLUMN error BOOLEAN DEFAULT 0"))
            db.commit()
        except Exception:
            db.rollback()

        # DB Migration: Add response_cache table if missing
        try:
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS response_cache (
                    key TEXT PRIMARY KEY,
                    response TEXT NOT NULL,
                    eval_count INTEGER,
                    eval_duration INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
        except Exception:
            db.rollback()

        # Cleanup interrupted background runs with a user-facing status and recovery note.
        try:
            interrupted_runs = (
                db.query(db_models.EvalRun)
                .filter(db_models.EvalRun.status.in_(("running", "pending")))
                .all()
            )
            for run in interrupted_runs:
                config = dict(run.config_json or {})
                config["completedWithErrors"] = bool(config.get("completedPairs"))
                config["progressPhase"] = "interrupted"
                config["progressMessage"] = "This run was interrupted when the app stopped."
                run.config_json = config
                run.status = "failed"
            db.commit()
        except Exception:
            db.rollback()
        try:
            cancelled_runs = (
                db.query(db_models.EvalRun)
                .filter(db_models.EvalRun.status == "cancel_requested")
                .all()
            )
            for run in cancelled_runs:
                config = dict(run.config_json or {})
                config["progressPhase"] = "cancelled"
                config["progressMessage"] = "This run was cancelled before the app restarted."
                run.config_json = config
                run.status = "cancelled"
            db.commit()
        except Exception:
            db.rollback()

        dataset_seeder.seed_if_empty(db)
        storage.repair_legacy_dataset_sources(db)
        # Auto-sync Ollama models on startup so the UI shows them immediately
        ollama_models = await list_models()
        if ollama_models:
            storage.upsert_models_from_ollama(db, ollama_models)
        # Pre-load METEOR scorer so NLTK downloads happen at startup, not during eval runs.
        # Intentionally synchronous — consistent with other blocking startup ops above (seed, migrations).
        meteor_scoring.warm_up()
    finally:
        db.close()
    yield


app = FastAPI(title="EvalBench API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3001", "http://localhost:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ollama_router.router)
app.include_router(models_router.router)
app.include_router(arena_router.router)
app.include_router(eval_runs_router.router)
app.include_router(eval_results_router.router)
app.include_router(datasets_router.router)
app.include_router(settings_router.router)
