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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables (no-op if they already exist)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        dataset_seeder.seed_if_empty(db)
        # Auto-sync Ollama models on startup so the UI shows them immediately
        ollama_models = await list_models()
        if ollama_models:
            storage.upsert_models_from_ollama(db, ollama_models)
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
