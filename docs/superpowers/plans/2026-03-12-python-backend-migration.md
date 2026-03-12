# Python Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express.js backend with a FastAPI (Python) backend, keeping the React frontend intact, so all evaluation logic, ML metrics, and HuggingFace integrations live in a single Python process.

**Architecture:** A FastAPI app in `backend/` replaces `server/`. SQLAlchemy + the existing `evalbench.db` SQLite file replace Drizzle. The React frontend is unchanged except `shared/routes.ts` loses its Drizzle imports and gains proper Zod schemas, and Vite gains a `/api` proxy. The Express server, Drizzle, and `server/` are deleted after parity is confirmed.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, Pydantic v2, httpx (async Ollama client), pytest + httpx AsyncClient (tests), uvicorn (dev server), concurrently (run Vite + uvicorn together).

---

## Context: What Exists Today

Current working features (must reach parity before cutover):
- `GET /api/models` — list models from DB
- `POST /api/models/discover` — sync from Ollama `/api/tags`, upsert to DB, init ELO
- `GET /api/ollama/status` — ping Ollama, return `{ running, modelCount }`
- `GET /api/arena/matchup` — pick 2 random models, call `POST /api/generate` on both in parallel
- `POST /api/arena/vote` — record battle, update ELO ratings
- `GET /api/arena/leaderboard` — models sorted by ELO rating
- `GET /api/eval-runs` / `POST /api/eval-runs` — list/create eval runs (scores currently mocked)
- `GET /api/eval-runs/:id/results` — results for a run
- `GET /api/datasets` — list golden datasets (empty)

The SQLite file `evalbench.db` is reused as-is. SQLAlchemy will create any missing tables on startup without dropping existing ones.

---

## File Map

### New files (create)

| File | Responsibility |
|---|---|
| `backend/main.py` | FastAPI app factory, CORS, lifespan (DB init), router registration |
| `backend/database.py` | SQLAlchemy engine, SessionLocal, Base, `get_db` dependency |
| `backend/models.py` | SQLAlchemy ORM table definitions (equivalent of shared/schema.ts) |
| `backend/schemas.py` | Pydantic v2 request/response models, camelCase aliases |
| `backend/routers/ollama.py` | `GET /api/ollama/status` |
| `backend/routers/models.py` | `GET /api/models`, `POST /api/models/discover` |
| `backend/routers/arena.py` | `GET /api/arena/matchup`, `POST /api/arena/vote`, `GET /api/arena/leaderboard` |
| `backend/routers/eval_runs.py` | `GET /api/eval-runs`, `POST /api/eval-runs`, `GET /api/eval-runs/:id`, `GET /api/eval-runs/:id/results` |
| `backend/routers/datasets.py` | `GET /api/datasets` |
| `backend/services/ollama.py` | httpx Ollama client: `check_status`, `list_models`, `generate` |
| `backend/services/storage.py` | All DB read/write operations (replaces server/storage.ts) |
| `requirements.txt` | Python dependencies |
| `tests/__init__.py` | Empty |
| `tests/conftest.py` | pytest fixtures: in-memory test DB, FastAPI TestClient |
| `tests/test_ollama_service.py` | Unit tests for the Ollama HTTP client |
| `tests/test_models_router.py` | Integration tests for model routes |
| `tests/test_arena_router.py` | Integration tests for arena routes |

### Modified files

| File | Change |
|---|---|
| `shared/routes.ts` | Remove Drizzle imports, replace `z.custom<typeof X.$inferSelect>()` with real Zod schemas. Add `size_gb` snake_case note — FastAPI returns camelCase via Pydantic aliases. |
| `vite.config.ts` | Add `server.proxy`: `/api` → `http://localhost:8001`, remove Replit-specific plugins |
| `package.json` | Add `dev:frontend`, `dev:backend`, `dev:all` scripts using concurrently |

### Deleted (after cutover in Chunk 6)

`server/`, `drizzle.config.ts`, `shared/schema.ts`, `migrations/`

---

## Chunk 1: FastAPI Project Foundation

### Task 1: Create `requirements.txt` and install deps

**Files:**
- Create: `requirements.txt`

- [ ] **Step 1: Create `requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.36
pydantic==2.9.2
pydantic-settings==2.5.2
httpx==0.27.2
pytest==8.3.3
pytest-asyncio==0.24.0
```

- [ ] **Step 2: Install**

```bash
pip install -r requirements.txt
```

Expected: All packages install without error.

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "chore: add Python requirements for FastAPI backend"
```

---

### Task 2: Database setup

**Files:**
- Create: `backend/__init__.py` (empty)
- Create: `backend/database.py`

- [ ] **Step 1: Write the failing test**

Create `tests/__init__.py` (empty) and `tests/conftest.py`:

```python
# tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.database import Base, get_db
from backend.main import app
from fastapi.testclient import TestClient

TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(scope="session")
def engine():
    e = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=e)
    yield e
    Base.metadata.drop_all(bind=e)

@pytest.fixture()
def db(engine):
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()

@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

Then write `tests/test_database.py`:

```python
# tests/test_database.py
def test_db_fixture_creates_tables(db):
    # If tables were created, this won't raise
    from sqlalchemy import text
    result = db.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
    tables = [row[0] for row in result]
    assert "models" in tables
    assert "elo_ratings" in tables
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_database.py -v
```

Expected: FAIL — `backend.database` module not found.

- [ ] **Step 3: Create `backend/__init__.py` and `backend/database.py`**

```python
# backend/__init__.py
# (empty)
```

```python
# backend/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./evalbench.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 4: Run test again**

```bash
pytest tests/test_database.py -v
```

Expected: FAIL — `backend.main` module not found (imported in conftest).

---

### Task 3: SQLAlchemy models

**Files:**
- Create: `backend/models.py`

- [ ] **Step 1: Create `backend/models.py`**

```python
# backend/models.py
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime, ForeignKey, JSON
)
from backend.database import Base


class Model(Base):
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    family = Column(String, nullable=True)
    params = Column(String, nullable=True)
    quantization = Column(String, nullable=True)
    size_gb = Column(Float, nullable=True)


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    config_json = Column(JSON, nullable=False)
    status = Column(String, nullable=False)


class EvalResult(Base):
    __tablename__ = "eval_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("eval_runs.id"), nullable=False)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    metric_name = Column(String, nullable=False)
    score = Column(Float, nullable=False)
    raw_output = Column(Text, nullable=True)


class GoldenDataset(Base):
    __tablename__ = "golden_datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    schema_version = Column(Integer, default=1)


class GoldenItem(Base):
    __tablename__ = "golden_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, ForeignKey("golden_datasets.id"), nullable=False)
    input = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=False)
    context = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    difficulty = Column(String, nullable=True)


class ArenaBattle(Base):
    __tablename__ = "arena_battles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_a_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    model_b_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    prompt = Column(Text, nullable=False)
    winner = Column(String, nullable=False)  # 'model_a', 'model_b', 'tie'
    timestamp = Column(DateTime, default=datetime.utcnow)


class EloRating(Base):
    __tablename__ = "elo_ratings"

    model_id = Column(Integer, ForeignKey("models.id"), primary_key=True)
    rating = Column(Integer, nullable=False, default=1200)
    games_played = Column(Integer, nullable=False, default=0)
    last_updated = Column(DateTime, default=datetime.utcnow)
```

---

### Task 4: Pydantic schemas

**Files:**
- Create: `backend/schemas.py`

Pydantic v2 with `alias_generator=to_camel` so FastAPI returns camelCase JSON — matching the existing frontend field names (`sizeGb`, `gamesPlayed`, etc.) without any frontend changes.

- [ ] **Step 1: Create `backend/schemas.py`**

```python
# backend/schemas.py
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that serializes to camelCase for the frontend."""
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


# --- Models ---

class ModelOut(CamelModel):
    id: int
    name: str
    family: Optional[str] = None
    params: Optional[str] = None
    quantization: Optional[str] = None
    size_gb: Optional[float] = None


# --- Eval Runs ---

class EvalRunOut(CamelModel):
    id: int
    timestamp: Optional[datetime] = None
    config_json: Any
    status: str


class EvalRunCreate(BaseModel):
    model_ids: list[int]
    benchmark_keys: list[str]
    dataset_id: Optional[int] = None


class EvalResultOut(CamelModel):
    id: int
    run_id: int
    model_id: int
    metric_name: str
    score: float
    raw_output: Optional[str] = None


# --- Datasets ---

class GoldenDatasetOut(CamelModel):
    id: int
    name: str
    source: Optional[str] = None
    created_at: Optional[datetime] = None
    schema_version: Optional[int] = None


# --- Arena ---

class ArenaBattleOut(CamelModel):
    id: int
    model_a_id: int
    model_b_id: int
    prompt: str
    winner: str
    timestamp: Optional[datetime] = None


class ArenaVoteIn(BaseModel):
    model_a_id: int
    model_b_id: int
    prompt: str
    winner: str  # 'model_a', 'model_b', 'tie'


class EloRatingOut(CamelModel):
    model_id: int
    rating: int
    games_played: int
    last_updated: Optional[datetime] = None


class LeaderboardEntry(BaseModel):
    model: ModelOut
    rating: EloRatingOut


class ArenaMatchupOut(BaseModel):
    prompt: str
    model_a: ModelOut
    model_b: ModelOut
    output_a: str
    output_b: str


# --- Ollama ---

class OllamaStatusOut(BaseModel):
    running: bool
    model_count: int
    error: Optional[str] = None
```

---

### Task 5: FastAPI app entry point

**Files:**
- Create: `backend/main.py`
- Create: `backend/routers/__init__.py` (empty)

- [ ] **Step 1: Create `backend/routers/__init__.py`** (empty file)

- [ ] **Step 2: Create `backend/main.py`**

```python
# backend/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.database import engine, Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (no-op if they already exist)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="EvalBench API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers registered in later tasks
```

- [ ] **Step 3: Run the database test**

```bash
pytest tests/test_database.py -v
```

Expected: PASS — conftest imports resolve, tables created in memory.

- [ ] **Step 4: Verify the app starts**

```bash
uvicorn backend.main:app --port 8001
```

Expected: `Application startup complete.` with no errors. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add backend/ tests/ requirements.txt
git commit -m "feat: FastAPI app skeleton — database, models, schemas, app factory"
```

---

## Chunk 2: Ollama Service + Status Endpoint

### Task 6: Ollama service

**Files:**
- Create: `backend/services/__init__.py` (empty)
- Create: `backend/services/ollama.py`
- Create: `tests/test_ollama_service.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ollama_service.py
import pytest
import httpx
from unittest.mock import AsyncMock, patch
from backend.services.ollama import check_status, list_models, generate


@pytest.mark.asyncio
async def test_check_status_returns_ok_when_ollama_up():
    mock_response = httpx.Response(
        200,
        json={"models": [{"name": "llama3:8b", "size": 4_000_000_000,
                          "details": {"family": "llama", "parameter_size": "8.0B",
                                      "quantization_level": "Q4_K_M"}}]},
        request=httpx.Request("GET", "http://localhost:11434/api/tags"),
    )
    with patch("httpx.AsyncClient.get", return_value=mock_response):
        result = await check_status()
    assert result["ok"] is True
    assert result["model_count"] == 1


@pytest.mark.asyncio
async def test_check_status_returns_not_ok_when_ollama_down():
    with patch("httpx.AsyncClient.get", side_effect=httpx.ConnectError("refused")):
        result = await check_status()
    assert result["ok"] is False
    assert result["model_count"] == 0
    assert "error" in result


@pytest.mark.asyncio
async def test_list_models_returns_empty_when_offline():
    with patch("httpx.AsyncClient.get", side_effect=httpx.ConnectError("refused")):
        models = await list_models()
    assert models == []


@pytest.mark.asyncio
async def test_generate_returns_response_text():
    mock_response = httpx.Response(
        200,
        json={"response": "The sky is blue because of Rayleigh scattering."},
        request=httpx.Request("POST", "http://localhost:11434/api/generate"),
    )
    with patch("httpx.AsyncClient.post", return_value=mock_response):
        result = await generate("llama3:8b", "Why is the sky blue?")
    assert result["ok"] is True
    assert "Rayleigh" in result["response"]


@pytest.mark.asyncio
async def test_generate_returns_error_when_offline():
    with patch("httpx.AsyncClient.post", side_effect=httpx.ConnectError("refused")):
        result = await generate("llama3:8b", "Why is the sky blue?")
    assert result["ok"] is False
    assert "error" in result
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pytest tests/test_ollama_service.py -v
```

Expected: FAIL — `backend.services.ollama` not found.

- [ ] **Step 3: Create `backend/services/__init__.py`** (empty)

- [ ] **Step 4: Create `backend/services/ollama.py`**

```python
# backend/services/ollama.py
import os
import httpx
from typing import Any

OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://localhost:11434")


async def check_status() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{OLLAMA_BASE}/api/tags", timeout=3.0)
            res.raise_for_status()
            data = res.json()
            models = data.get("models", [])
            return {"ok": True, "model_count": len(models), "models": models}
    except Exception as e:
        return {"ok": False, "model_count": 0, "models": [], "error": str(e)}


async def list_models() -> list[dict]:
    result = await check_status()
    return result["models"] if result["ok"] else []


async def generate(model: str, prompt: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{OLLAMA_BASE}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
                timeout=120.0,
            )
            res.raise_for_status()
            data = res.json()
            return {"ok": True, "response": data["response"]}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_ollama_service.py -v
```

Expected: All 5 PASS.

---

### Task 7: Ollama status router

**Files:**
- Create: `backend/routers/ollama.py`
- Create: `tests/test_ollama_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ollama_router.py
from unittest.mock import patch, AsyncMock


def test_ollama_status_running(client):
    mock_result = {"ok": True, "model_count": 5, "models": [], "error": None}
    with patch("backend.routers.ollama.check_status", new_callable=AsyncMock,
               return_value=mock_result):
        res = client.get("/api/ollama/status")
    assert res.status_code == 200
    data = res.json()
    assert data["running"] is True
    assert data["modelCount"] == 5


def test_ollama_status_offline(client):
    mock_result = {"ok": False, "model_count": 0, "models": [], "error": "Connection refused"}
    with patch("backend.routers.ollama.check_status", new_callable=AsyncMock,
               return_value=mock_result):
        res = client.get("/api/ollama/status")
    assert res.status_code == 200
    data = res.json()
    assert data["running"] is False
    assert data["error"] == "Connection refused"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_ollama_router.py -v
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Create `backend/routers/ollama.py`**

```python
# backend/routers/ollama.py
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
```

- [ ] **Step 4: Register router in `backend/main.py`**

Add after the middleware block:

```python
from backend.routers import ollama as ollama_router
app.include_router(ollama_router.router)
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_ollama_router.py -v
```

Expected: Both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/ backend/routers/ollama.py tests/
git commit -m "feat: Ollama service + GET /api/ollama/status endpoint"
```

---

## Chunk 3: Models Routes

### Task 8: Storage service — models

**Files:**
- Create: `backend/services/storage.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_models_router.py
from unittest.mock import patch, AsyncMock


def test_get_models_empty(client):
    res = client.get("/api/models")
    assert res.status_code == 200
    assert res.json() == []


def test_discover_models_with_ollama_offline(client):
    with patch("backend.routers.models.list_models", new_callable=AsyncMock,
               return_value=[]):
        res = client.post("/api/models/discover")
    assert res.status_code == 200
    assert res.json() == []


def test_discover_models_syncs_from_ollama(client):
    fake_ollama_models = [
        {
            "name": "llama3:8b",
            "size": 4_800_000_000,
            "details": {
                "family": "llama",
                "parameter_size": "8.0B",
                "quantization_level": "Q4_K_M",
            },
        }
    ]
    with patch("backend.routers.models.list_models", new_callable=AsyncMock,
               return_value=fake_ollama_models):
        res = client.post("/api/models/discover")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["name"] == "llama3:8b"
    assert data[0]["family"] == "llama"
    assert data[0]["sizeGb"] == pytest.approx(4.8, abs=0.1)


def test_discover_models_no_duplicates_on_second_call(client):
    fake_models = [
        {"name": "llama3:8b", "size": 4_800_000_000,
         "details": {"family": "llama", "parameter_size": "8.0B",
                     "quantization_level": "Q4_K_M"}}
    ]
    with patch("backend.routers.models.list_models", new_callable=AsyncMock,
               return_value=fake_models):
        client.post("/api/models/discover")
        res = client.post("/api/models/discover")
    assert res.status_code == 200
    assert len(res.json()) == 1  # not 2
```

Add `import pytest` at top of `tests/test_models_router.py`.

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_models_router.py -v
```

Expected: FAIL — `/api/models` not found.

- [ ] **Step 3: Create `backend/services/storage.py`**

```python
# backend/services/storage.py
import random
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from backend import models as db_models


# --- Models ---

def get_models(db: Session) -> list[db_models.Model]:
    return db.query(db_models.Model).all()


def upsert_models_from_ollama(db: Session, ollama_models: list[dict]) -> list[db_models.Model]:
    """Upsert Ollama models and initialise ELO for any new ones."""
    for om in ollama_models:
        size_gb = round(om["size"] / 1e9, 2)
        existing = db.query(db_models.Model).filter_by(name=om["name"]).first()
        if existing:
            existing.family = om["details"].get("family")
            existing.params = om["details"].get("parameter_size")
            existing.quantization = om["details"].get("quantization_level")
            existing.size_gb = size_gb
        else:
            new_model = db_models.Model(
                name=om["name"],
                family=om["details"].get("family"),
                params=om["details"].get("parameter_size"),
                quantization=om["details"].get("quantization_level"),
                size_gb=size_gb,
            )
            db.add(new_model)
            db.flush()  # get the new id

            elo = db_models.EloRating(
                model_id=new_model.id,
                rating=1200,
                games_played=0,
            )
            db.add(elo)

    db.commit()
    return get_models(db)


# --- Arena ---

def get_arena_leaderboard(db: Session) -> list[dict]:
    all_models = db.query(db_models.Model).all()
    all_ratings = db.query(db_models.EloRating).all()
    ratings_by_id = {r.model_id: r for r in all_ratings}

    result = []
    for m in all_models:
        rating = ratings_by_id.get(m.id) or db_models.EloRating(
            model_id=m.id, rating=1200, games_played=0
        )
        result.append({"model": m, "rating": rating})

    return sorted(result, key=lambda x: x["rating"].rating, reverse=True)


def create_arena_vote(db: Session, model_a_id: int, model_b_id: int,
                      prompt: str, winner: str) -> db_models.ArenaBattle:
    battle = db_models.ArenaBattle(
        model_a_id=model_a_id,
        model_b_id=model_b_id,
        prompt=prompt,
        winner=winner,
    )
    db.add(battle)

    K = 32
    if winner != "tie":
        winner_id = model_a_id if winner == "model_a" else model_b_id
        loser_id = model_b_id if winner == "model_a" else model_a_id

        w_elo = db.query(db_models.EloRating).filter_by(model_id=winner_id).first()
        l_elo = db.query(db_models.EloRating).filter_by(model_id=loser_id).first()

        if w_elo and l_elo:
            expected_w = 1 / (1 + 10 ** ((l_elo.rating - w_elo.rating) / 400))
            expected_l = 1 / (1 + 10 ** ((w_elo.rating - l_elo.rating) / 400))
            w_elo.rating = round(w_elo.rating + K * (1 - expected_w))
            w_elo.games_played += 1
            l_elo.rating = round(l_elo.rating + K * (0 - expected_l))
            l_elo.games_played += 1
    else:
        a_elo = db.query(db_models.EloRating).filter_by(model_id=model_a_id).first()
        b_elo = db.query(db_models.EloRating).filter_by(model_id=model_b_id).first()
        if a_elo:
            a_elo.games_played += 1
        if b_elo:
            b_elo.games_played += 1

    db.commit()
    db.refresh(battle)
    return battle


# --- Eval Runs ---

def get_eval_runs(db: Session) -> list[db_models.EvalRun]:
    return db.query(db_models.EvalRun).order_by(db_models.EvalRun.timestamp.desc()).all()


def create_eval_run(db: Session, config_json: dict) -> db_models.EvalRun:
    run = db_models.EvalRun(config_json=config_json, status="completed")
    db.add(run)
    db.flush()

    all_models = get_models(db)
    for m in all_models[:2]:
        db.add(db_models.EvalResult(
            run_id=run.id, model_id=m.id,
            metric_name="Speed (T/s)",
            score=round(random.uniform(20, 70), 2),
        ))
        db.add(db_models.EvalResult(
            run_id=run.id, model_id=m.id,
            metric_name="MMLU",
            score=round(random.uniform(40, 80), 2),
        ))

    db.commit()
    db.refresh(run)
    return run


def get_eval_run(db: Session, run_id: int) -> db_models.EvalRun | None:
    return db.query(db_models.EvalRun).filter_by(id=run_id).first()


def get_eval_results(db: Session, run_id: int) -> list[db_models.EvalResult]:
    return db.query(db_models.EvalResult).filter_by(run_id=run_id).all()


# --- Datasets ---

def get_golden_datasets(db: Session) -> list[db_models.GoldenDataset]:
    return db.query(db_models.GoldenDataset).all()
```

- [ ] **Step 4: Create `backend/routers/models.py`**

```python
# backend/routers/models.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import ModelOut
from backend.services import storage
from backend.services.ollama import list_models

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelOut])
def get_models(db: Session = Depends(get_db)):
    return storage.get_models(db)


@router.post("/discover", response_model=list[ModelOut])
async def discover_models(db: Session = Depends(get_db)):
    ollama_models = await list_models()
    if not ollama_models:
        return storage.get_models(db)
    return storage.upsert_models_from_ollama(db, ollama_models)
```

- [ ] **Step 5: Register router in `backend/main.py`**

```python
from backend.routers import models as models_router
app.include_router(models_router.router)
```

- [ ] **Step 6: Run tests**

```bash
pytest tests/test_models_router.py -v
```

Expected: All 4 PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/storage.py backend/routers/models.py tests/test_models_router.py
git commit -m "feat: models routes — GET /api/models, POST /api/models/discover"
```

---

## Chunk 4: Arena + Eval Runs + Datasets Routes

### Task 9: Arena routes

**Files:**
- Create: `backend/routers/arena.py`
- Create: `tests/test_arena_router.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_arena_router.py
from unittest.mock import patch, AsyncMock
from backend import models as db_models
from backend.database import Base


def _seed_two_models(db):
    """Helper: insert 2 models + their ELO so matchup can proceed."""
    for name in ["llama3:8b", "mistral:7b"]:
        m = db_models.Model(name=name, family="llama", params="8B",
                            quantization="Q4", size_gb=4.5)
        db.add(m)
        db.flush()
        db.add(db_models.EloRating(model_id=m.id, rating=1200, games_played=0))
    db.commit()


def test_leaderboard_empty(client):
    res = client.get("/api/arena/leaderboard")
    assert res.status_code == 200
    assert res.json() == []


def test_leaderboard_after_seeding(client, db):
    _seed_two_models(db)
    res = client.get("/api/arena/leaderboard")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 2
    assert "model" in data[0]
    assert "rating" in data[0]


def test_arena_matchup_requires_two_models(client):
    res = client.get("/api/arena/matchup")
    assert res.status_code == 400


def test_arena_matchup_returns_real_generation(client, db):
    _seed_two_models(db)
    with patch("backend.routers.arena.generate", new_callable=AsyncMock,
               return_value={"ok": True, "response": "Test response"}):
        res = client.get("/api/arena/matchup")
    assert res.status_code == 200
    data = res.json()
    assert data["outputA"] == "Test response"
    assert data["outputB"] == "Test response"
    assert "prompt" in data


def test_arena_vote_updates_elo(client, db):
    _seed_two_models(db)
    models = db.query(db_models.Model).all()
    vote_payload = {
        "modelAId": models[0].id,
        "modelBId": models[1].id,
        "prompt": "Test prompt",
        "winner": "model_a",
    }
    res = client.post("/api/arena/vote", json=vote_payload)
    assert res.status_code == 201
    # Winner's ELO should have gone up from 1200
    winner_elo = db.query(db_models.EloRating).filter_by(model_id=models[0].id).first()
    assert winner_elo.rating > 1200
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_arena_router.py -v
```

Expected: FAIL — routes not registered.

- [ ] **Step 3: Create `backend/routers/arena.py`**

```python
# backend/routers/arena.py
import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import (
    ArenaMatchupOut, ArenaVoteIn, ArenaBattleOut,
    LeaderboardEntry, ModelOut, EloRatingOut,
)
from backend.services import storage
from backend.services.ollama import generate

router = APIRouter(prefix="/api/arena", tags=["arena"])

PROMPTS = [
    "Explain quantum computing in one sentence.",
    "Write a haiku about artificial intelligence.",
    "What is the capital of France?",
    "Why is the sky blue?",
    "What is the difference between supervised and unsupervised learning?",
    "Explain the trolley problem briefly.",
]


@router.get("/matchup")
async def get_matchup(db: Session = Depends(get_db)):
    all_models = storage.get_models(db)
    if len(all_models) < 2:
        raise HTTPException(status_code=400, detail="At least 2 models required for arena matchup")

    shuffled = random.sample(all_models, 2)
    model_a, model_b = shuffled[0], shuffled[1]
    prompt = random.choice(PROMPTS)

    result_a, result_b = await generate(model_a.name, prompt), await generate(model_b.name, prompt)

    return {
        "prompt": prompt,
        "modelA": ModelOut.model_validate(model_a).model_dump(by_alias=True),
        "modelB": ModelOut.model_validate(model_b).model_dump(by_alias=True),
        "outputA": result_a["response"] if result_a["ok"] else f"[Error: {result_a.get('error')}]",
        "outputB": result_b["response"] if result_b["ok"] else f"[Error: {result_b.get('error')}]",
    }


@router.post("/vote", status_code=201, response_model=ArenaBattleOut)
def vote(vote_in: ArenaVoteIn, db: Session = Depends(get_db)):
    battle = storage.create_arena_vote(
        db,
        model_a_id=vote_in.model_a_id,
        model_b_id=vote_in.model_b_id,
        prompt=vote_in.prompt,
        winner=vote_in.winner,
    )
    return battle


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(db: Session = Depends(get_db)):
    return storage.get_arena_leaderboard(db)
```

- [ ] **Step 4: Register router in `backend/main.py`**

```python
from backend.routers import arena as arena_router
app.include_router(arena_router.router)
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_arena_router.py -v
```

Expected: All 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/arena.py tests/test_arena_router.py
git commit -m "feat: arena routes — matchup, vote, leaderboard"
```

---

### Task 10: Eval runs + datasets routes

**Files:**
- Create: `backend/routers/eval_runs.py`
- Create: `backend/routers/datasets.py`

- [ ] **Step 1: Create `backend/routers/eval_runs.py`**

```python
# backend/routers/eval_runs.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import EvalRunOut, EvalRunCreate, EvalResultOut
from backend.services import storage

router = APIRouter(prefix="/api/eval-runs", tags=["eval-runs"])


@router.get("", response_model=list[EvalRunOut])
def list_runs(db: Session = Depends(get_db)):
    return storage.get_eval_runs(db)


@router.post("", status_code=201, response_model=EvalRunOut)
def create_run(body: EvalRunCreate, db: Session = Depends(get_db)):
    return storage.create_eval_run(db, config_json=body.model_dump())


@router.get("/{run_id}", response_model=EvalRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = storage.get_eval_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/{run_id}/results", response_model=list[EvalResultOut])
def get_results(run_id: int, db: Session = Depends(get_db)):
    return storage.get_eval_results(db, run_id)
```

- [ ] **Step 2: Create `backend/routers/datasets.py`**

```python
# backend/routers/datasets.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import GoldenDatasetOut
from backend.services import storage

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=list[GoldenDatasetOut])
def list_datasets(db: Session = Depends(get_db)):
    return storage.get_golden_datasets(db)
```

- [ ] **Step 3: Register both routers in `backend/main.py`**

```python
from backend.routers import eval_runs as eval_runs_router
from backend.routers import datasets as datasets_router
app.include_router(eval_runs_router.router)
app.include_router(datasets_router.router)
```

- [ ] **Step 4: Run the full test suite**

```bash
pytest tests/ -v
```

Expected: All tests pass.

- [ ] **Step 5: Manual smoke test — start FastAPI and hit each endpoint**

```bash
uvicorn backend.main:app --port 8001 --reload
```

In another terminal:
```bash
curl http://localhost:8001/api/ollama/status
curl http://localhost:8001/api/models
curl -X POST http://localhost:8001/api/models/discover
curl http://localhost:8001/api/arena/leaderboard
curl http://localhost:8001/api/eval-runs
curl http://localhost:8001/api/datasets
```

Expected: All return 200 with valid JSON. No 500s.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/eval_runs.py backend/routers/datasets.py backend/main.py
git commit -m "feat: eval-runs and datasets routes, complete FastAPI backend at parity"
```

---

## Chunk 5: Frontend Decoupling + Vite Proxy

### Task 11: Rewrite `shared/routes.ts` — remove Drizzle, add real Zod schemas

The current `shared/routes.ts` uses `z.custom<typeof models.$inferSelect>()` which leaks Drizzle types into the frontend. Replace with concrete Zod schemas that match the FastAPI response shapes. The `@shared/schema.ts` file becomes unused and is deleted.

**Files:**
- Modify: `shared/routes.ts`
- Delete: `shared/schema.ts`

- [ ] **Step 1: Rewrite `shared/routes.ts`**

```typescript
// shared/routes.ts
import { z } from 'zod';

// --- Response schemas (must match FastAPI Pydantic output) ---
// FastAPI uses camelCase aliases via pydantic alias_generator=to_camel

export const ModelSchema = z.object({
  id: z.number(),
  name: z.string(),
  family: z.string().nullable(),
  params: z.string().nullable(),
  quantization: z.string().nullable(),
  sizeGb: z.number().nullable(),
});

export const EloRatingSchema = z.object({
  modelId: z.number(),
  rating: z.number(),
  gamesPlayed: z.number(),
  lastUpdated: z.string().nullable().optional(),
});

export const EvalRunSchema = z.object({
  id: z.number(),
  timestamp: z.string().nullable().optional(),
  configJson: z.any(),
  status: z.string(),
});

export const EvalResultSchema = z.object({
  id: z.number(),
  runId: z.number(),
  modelId: z.number(),
  metricName: z.string(),
  score: z.number(),
  rawOutput: z.string().nullable().optional(),
});

export const GoldenDatasetSchema = z.object({
  id: z.number(),
  name: z.string(),
  source: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  schemaVersion: z.number().nullable().optional(),
});

export const ArenaBattleSchema = z.object({
  id: z.number(),
  modelAId: z.number(),
  modelBId: z.number(),
  prompt: z.string(),
  winner: z.string(),
  timestamp: z.string().nullable().optional(),
});

export const LeaderboardEntrySchema = z.object({
  model: ModelSchema,
  rating: EloRatingSchema,
});

export const OllamaStatusSchema = z.object({
  running: z.boolean(),
  modelCount: z.number(),
  error: z.string().optional(),
});

// --- API route map ---

export const api = {
  models: {
    list: {
      method: 'GET' as const,
      path: '/api/models' as const,
      responses: { 200: z.array(ModelSchema) },
    },
    discover: {
      method: 'POST' as const,
      path: '/api/models/discover' as const,
      responses: { 200: z.array(ModelSchema) },
    },
  },
  ollama: {
    status: {
      method: 'GET' as const,
      path: '/api/ollama/status' as const,
      responses: { 200: OllamaStatusSchema },
    },
  },
  evalRuns: {
    list: {
      method: 'GET' as const,
      path: '/api/eval-runs' as const,
      responses: { 200: z.array(EvalRunSchema) },
    },
    create: {
      method: 'POST' as const,
      path: '/api/eval-runs' as const,
      input: z.object({
        modelIds: z.array(z.number()),
        benchmarkKeys: z.array(z.string()),
        datasetId: z.number().optional(),
      }),
      responses: {
        201: EvalRunSchema,
        400: z.object({ message: z.string() }),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id' as const,
      responses: {
        200: EvalRunSchema,
        404: z.object({ message: z.string() }),
      },
    },
    results: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id/results' as const,
      responses: { 200: z.array(EvalResultSchema) },
    },
  },
  datasets: {
    list: {
      method: 'GET' as const,
      path: '/api/datasets' as const,
      responses: { 200: z.array(GoldenDatasetSchema) },
    },
  },
  arena: {
    getMatchup: {
      method: 'GET' as const,
      path: '/api/arena/matchup' as const,
      responses: {
        200: z.object({
          prompt: z.string(),
          modelA: ModelSchema,
          modelB: ModelSchema,
          outputA: z.string(),
          outputB: z.string(),
        }),
      },
    },
    vote: {
      method: 'POST' as const,
      path: '/api/arena/vote' as const,
      input: z.object({
        modelAId: z.number(),
        modelBId: z.number(),
        prompt: z.string(),
        winner: z.enum(['model_a', 'model_b', 'tie']),
      }),
      responses: {
        201: ArenaBattleSchema,
        400: z.object({ message: z.string() }),
      },
    },
    leaderboard: {
      method: 'GET' as const,
      path: '/api/arena/leaderboard' as const,
      responses: { 200: z.array(LeaderboardEntrySchema) },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`:${key}`, String(value));
    });
  }
  return url;
}

export type Model = z.infer<typeof ModelSchema>;
export type EvalRun = z.infer<typeof EvalRunSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
export type GoldenDataset = z.infer<typeof GoldenDatasetSchema>;
export type ArenaBattle = z.infer<typeof ArenaBattleSchema>;
export type EloRating = z.infer<typeof EloRatingSchema>;
```

- [ ] **Step 2: Delete `shared/schema.ts`**

```bash
rm shared/schema.ts
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "client/src/components/ui"
```

Expected: No errors outside the pre-existing `Button.tsx` casing issue.

---

### Task 12: Add Vite proxy + update dev scripts

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`

Currently the Express server serves both API and Vite in dev. After migration, Vite runs standalone and proxies `/api` to FastAPI.

- [ ] **Step 1: Update `vite.config.ts`**

Replace the `server` block:

```typescript
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
```

Also remove the Replit-specific plugin imports (they check `REPL_ID` so are no-ops locally, but clean to remove):

```typescript
// Remove the entire Replit conditionals block:
// ...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined ? [...] : [])
```

- [ ] **Step 2: Install `concurrently`**

```bash
npm install --save-dev concurrently
```

- [ ] **Step 3: Update `package.json` scripts**

```json
"scripts": {
  "dev:frontend": "vite",
  "dev:backend": "uvicorn backend.main:app --port 8001 --reload",
  "dev": "concurrently -n frontend,backend -c cyan,green \"npm run dev:frontend\" \"npm run dev:backend\"",
  "build": "tsc -b && vite build",
  "check": "tsc --noEmit"
}
```

- [ ] **Step 4: Test full stack locally**

```bash
npm run dev
```

Expected:
- Vite starts on port 5173
- uvicorn starts on port 8001
- Open `http://localhost:5173` — app loads
- Models page shows Ollama status indicator
- `POST /api/models/discover` works through the proxy

- [ ] **Step 5: Commit**

```bash
git add shared/routes.ts vite.config.ts package.json package-lock.json
git commit -m "feat: decouple frontend from Drizzle, add Vite proxy to FastAPI"
```

---

## Chunk 6: Cutover — Delete Node Backend

> **Only do this after the full stack test in Task 12 passes.**

### Task 13: Delete Express backend + clean up

**Files to delete:**
- `server/` (entire directory)
- `drizzle.config.ts`
- `migrations/` (entire directory, if present)

**Packages to remove from `package.json`:**
- `better-sqlite3`, `@types/better-sqlite3`
- `drizzle-orm`, `drizzle-zod`, `drizzle-kit`
- `express`, `@types/express`, `@types/express-session`, `express-session`
- `connect-pg-simple`, `@types/connect-pg-simple`
- `passport`, `passport-local`, `@types/passport`, `@types/passport-local`
- `tsx` (only needed for running the Express server)
- Replit vite plugins: `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal`

- [ ] **Step 1: Delete server directory and Drizzle config**

```bash
rm -rf server/ drizzle.config.ts migrations/
```

- [ ] **Step 2: Remove Node backend packages**

```bash
npm uninstall better-sqlite3 @types/better-sqlite3 drizzle-orm drizzle-zod drizzle-kit express @types/express express-session @types/express-session connect-pg-simple @types/connect-pg-simple passport passport-local @types/passport @types/passport-local tsx @replit/vite-plugin-cartographer @replit/vite-plugin-dev-banner @replit/vite-plugin-runtime-error-modal
```

- [ ] **Step 3: Clean up `vite.config.ts` — remove leftover Replit imports**

Remove the `runtimeErrorOverlay` import and its usage since the package is gone. Final `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "client/src/components/ui"
```

Expected: No new errors.

- [ ] **Step 5: Full stack smoke test**

```bash
npm run dev
```

Visit `http://localhost:5173`. Verify:
- [ ] Models page loads, Ollama status indicator shows
- [ ] "Discover Models" syncs real models
- [ ] Arena loads a matchup with real model outputs
- [ ] Vote updates ELO (leaderboard changes)
- [ ] EvalWizard creates a run (mock scores still, that's fine)

- [ ] **Step 6: Run Python tests one final time**

```bash
pytest tests/ -v
```

Expected: All PASS.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete migration to FastAPI Python backend, remove Express/Drizzle"
```

---

## Testing Checklist (pre-cutover)

Before deleting the Node backend, verify these manually with FastAPI running:

- [ ] `GET /api/ollama/status` → `{ running: true/false, modelCount: N }`
- [ ] `POST /api/models/discover` → list of real models from Ollama
- [ ] `GET /api/models` → same list from DB
- [ ] `GET /api/arena/matchup` → real prompt + real generated responses
- [ ] `POST /api/arena/vote` → 201, ELO updated
- [ ] `GET /api/arena/leaderboard` → models sorted by rating
- [ ] `POST /api/eval-runs` → 201, mock scores created
- [ ] `GET /api/eval-runs/:id/results` → list of results
- [ ] `GET /api/datasets` → empty list (no crash)

---

## Chunk 7: Provider Abstraction Layer

> **Run after Chunk 6 cutover.** This refactors the arena and model discovery to use an abstract provider interface so adding OpenAI, Anthropic, or any other LLM backend is a one-file addition with zero changes to routers.

### Task 14: Abstract provider base + Ollama provider

**Files:**
- Create: `backend/providers/__init__.py` (empty)
- Create: `backend/providers/base.py`
- Create: `backend/providers/ollama.py` (replaces `backend/services/ollama.py`)
- Create: `backend/providers/openai_provider.py` (stub)
- Create: `backend/providers/registry.py`
- Modify: `backend/routers/arena.py` — use provider instead of raw `generate()`
- Modify: `backend/routers/models.py` — use provider instead of raw `list_models()`
- Create: `tests/test_providers.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_providers.py
import pytest
from unittest.mock import patch, AsyncMock
import httpx
from backend.providers.ollama import OllamaProvider
from backend.providers.registry import get_provider, list_available_providers


@pytest.mark.asyncio
async def test_ollama_provider_generate_success():
    mock_response = httpx.Response(
        200,
        json={"response": "42 is the answer."},
        request=httpx.Request("POST", "http://localhost:11434/api/generate"),
    )
    provider = OllamaProvider()
    with patch("httpx.AsyncClient.post", return_value=mock_response):
        result = await provider.generate("llama3:8b", "What is 6 times 7?")
    assert result["ok"] is True
    assert "42" in result["response"]


@pytest.mark.asyncio
async def test_ollama_provider_generate_failure():
    provider = OllamaProvider()
    with patch("httpx.AsyncClient.post", side_effect=httpx.ConnectError("refused")):
        result = await provider.generate("llama3:8b", "test")
    assert result["ok"] is False


def test_registry_returns_ollama_provider():
    provider = get_provider("ollama")
    assert isinstance(provider, OllamaProvider)


def test_registry_raises_on_unknown_provider():
    with pytest.raises(ValueError, match="Unknown provider"):
        get_provider("fakemodel")


def test_list_available_providers():
    providers = list_available_providers()
    assert "ollama" in providers
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_providers.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `backend/providers/base.py`**

```python
# backend/providers/base.py
from abc import ABC, abstractmethod
from typing import Any


class LLMProvider(ABC):
    """Abstract interface for any LLM backend — Ollama, OpenAI, Anthropic, etc."""

    @abstractmethod
    async def generate(self, model: str, prompt: str, system: str = "") -> dict[str, Any]:
        """
        Returns: { ok: bool, response?: str, error?: str,
                   tokens_per_second?: float, total_tokens?: int }
        Never raises — always returns ok=False with error on failure.
        """

    @abstractmethod
    async def list_models(self) -> list[dict]:
        """Returns list of available model dicts with 'name', 'size', 'details' keys."""

    @abstractmethod
    async def is_available(self) -> bool:
        """Quick health check — returns True if provider is reachable."""

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Unique string ID, e.g. 'ollama', 'openai', 'anthropic'."""
```

- [ ] **Step 4: Create `backend/providers/ollama.py`**

```python
# backend/providers/ollama.py
import os
import httpx
from typing import Any
from backend.providers.base import LLMProvider

OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://localhost:11434")


class OllamaProvider(LLMProvider):
    """Ollama local inference provider."""

    @property
    def provider_id(self) -> str:
        return "ollama"

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{OLLAMA_BASE}/api/tags", timeout=3.0)
                return res.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{OLLAMA_BASE}/api/tags", timeout=3.0)
                res.raise_for_status()
                return res.json().get("models", [])
        except Exception:
            return []

    async def get_status(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{OLLAMA_BASE}/api/tags", timeout=3.0)
                res.raise_for_status()
                models = res.json().get("models", [])
                return {"ok": True, "model_count": len(models), "models": models}
        except Exception as e:
            return {"ok": False, "model_count": 0, "models": [], "error": str(e)}

    async def generate(self, model: str, prompt: str, system: str = "") -> dict[str, Any]:
        try:
            payload: dict[str, Any] = {"model": model, "prompt": prompt, "stream": False}
            if system:
                payload["system"] = system
            async with httpx.AsyncClient() as client:
                res = await client.post(
                    f"{OLLAMA_BASE}/api/generate",
                    json=payload,
                    timeout=120.0,
                )
                res.raise_for_status()
                data = res.json()
                tps = None
                if data.get("eval_duration") and data.get("eval_count"):
                    tps = round(data["eval_count"] / (data["eval_duration"] / 1e9), 1)
                return {
                    "ok": True,
                    "response": data["response"],
                    "tokens_per_second": tps,
                    "total_tokens": data.get("eval_count"),
                }
        except Exception as e:
            return {"ok": False, "error": str(e)}
```

- [ ] **Step 5: Create `backend/providers/openai_provider.py`** (stub — not wired yet)

```python
# backend/providers/openai_provider.py
"""
OpenAI provider — stub. Wire up when OPENAI_API_KEY is present.
Install: pip install openai
"""
import os
from typing import Any
from backend.providers.base import LLMProvider


class OpenAIProvider(LLMProvider):
    """OpenAI API provider (GPT-4o, GPT-4, GPT-3.5-turbo, etc.)"""

    @property
    def provider_id(self) -> str:
        return "openai"

    async def is_available(self) -> bool:
        return bool(os.getenv("OPENAI_API_KEY"))

    async def list_models(self) -> list[dict]:
        # Returns static list — OpenAI models don't need discovery
        return [
            {"name": "gpt-4o", "size": 0, "details": {"family": "gpt", "parameter_size": "unknown", "quantization_level": "none"}},
            {"name": "gpt-4o-mini", "size": 0, "details": {"family": "gpt", "parameter_size": "unknown", "quantization_level": "none"}},
        ]

    async def generate(self, model: str, prompt: str, system: str = "") -> dict[str, Any]:
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            response = await client.chat.completions.create(model=model, messages=messages)
            return {"ok": True, "response": response.choices[0].message.content}
        except Exception as e:
            return {"ok": False, "error": str(e)}
```

- [ ] **Step 6: Create `backend/providers/registry.py`**

```python
# backend/providers/registry.py
from backend.providers.base import LLMProvider
from backend.providers.ollama import OllamaProvider
from backend.providers.openai_provider import OpenAIProvider

_REGISTRY: dict[str, type[LLMProvider]] = {
    "ollama": OllamaProvider,
    "openai": OpenAIProvider,
}


def get_provider(provider_id: str) -> LLMProvider:
    if provider_id not in _REGISTRY:
        raise ValueError(f"Unknown provider '{provider_id}'. Available: {list(_REGISTRY)}")
    return _REGISTRY[provider_id]()


def list_available_providers() -> list[str]:
    return list(_REGISTRY.keys())
```

- [ ] **Step 7: Update `backend/routers/arena.py`** — use provider instead of raw service call

Replace the import and generate call:

```python
# In backend/routers/arena.py — replace:
from backend.services.ollama import generate
# with:
from backend.providers.registry import get_provider
```

Replace the generate calls in `get_matchup`:

```python
    provider = get_provider("ollama")
    result_a, result_b = await asyncio.gather(
        provider.generate(model_a.name, prompt),
        provider.generate(model_b.name, prompt),
    )
```

Add `import asyncio` at the top.

- [ ] **Step 8: Update `backend/routers/models.py`** — use provider

```python
# Replace: from backend.services.ollama import list_models
# With:
from backend.providers.registry import get_provider

# In discover_models():
provider = get_provider("ollama")
ollama_models = await provider.list_models()
```

- [ ] **Step 9: Update `backend/routers/ollama.py`** — use provider

```python
# Replace: from backend.services.ollama import check_status
# With:
from backend.providers.registry import get_provider

# In ollama_status():
provider = get_provider("ollama")  # type: ignore
result = await provider.get_status()  # OllamaProvider-specific method
```

- [ ] **Step 10: Run tests**

```bash
pytest tests/ -v
```

Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git add backend/providers/ tests/test_providers.py backend/routers/
git commit -m "feat: provider abstraction layer — Ollama + OpenAI stub, registry pattern"
```

---

## Chunk 8: Arena Enhancements

Two problems to fix + one feature to add:
1. **Model names disappear** — `votedFor` resets before user reads the reveal
2. **No model reveal state** — voting immediately triggers next matchup fetch
3. **User-submitted prompts** — user should be able to type their own prompt instead of using the random one

### Task 15: Backend — user-submitted prompt support

**Files:**
- Modify: `backend/routers/arena.py` — accept optional `prompt` query param

- [ ] **Step 1: Write failing test**

```python
# In tests/test_arena_router.py — add:

def test_matchup_uses_custom_prompt(client, db):
    _seed_two_models(db)
    custom = "What is the meaning of life?"
    with patch("backend.routers.arena.generate", new_callable=AsyncMock,
               return_value={"ok": True, "response": "42"}):
        res = client.get(f"/api/arena/matchup?prompt={custom}")
    assert res.status_code == 200
    assert res.json()["prompt"] == custom
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_arena_router.py::test_matchup_uses_custom_prompt -v
```

- [ ] **Step 3: Update `get_matchup` in `backend/routers/arena.py`**

Add `prompt` as an optional query parameter:

```python
from typing import Optional

@router.get("/matchup")
async def get_matchup(
    prompt: Optional[str] = None,
    db: Session = Depends(get_db),
):
    all_models = storage.get_models(db)
    if len(all_models) < 2:
        raise HTTPException(status_code=400, detail="At least 2 models required")

    shuffled = random.sample(all_models, 2)
    model_a, model_b = shuffled[0], shuffled[1]
    chosen_prompt = prompt if prompt else random.choice(PROMPTS)

    provider = get_provider("ollama")
    result_a, result_b = await asyncio.gather(
        provider.generate(model_a.name, chosen_prompt),
        provider.generate(model_b.name, chosen_prompt),
    )

    return {
        "prompt": chosen_prompt,
        "modelA": ModelOut.model_validate(model_a).model_dump(by_alias=True),
        "modelB": ModelOut.model_validate(model_b).model_dump(by_alias=True),
        "outputA": result_a["response"] if result_a["ok"] else f"[Error: {result_a.get('error')}]",
        "outputB": result_b["response"] if result_b["ok"] else f"[Error: {result_b.get('error')}]",
    }
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_arena_router.py -v
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/arena.py tests/test_arena_router.py
git commit -m "feat: arena matchup accepts optional user-submitted prompt"
```

---

### Task 16: Frontend — model reveal + custom prompt input

**Files:**
- Modify: `client/src/hooks/use-arena.ts` — `useArenaMatchup` accepts optional prompt
- Modify: `client/src/pages/Arena.tsx` — reveal state, custom prompt input

- [ ] **Step 1: Update `client/src/hooks/use-arena.ts`**

Replace `useArenaMatchup` and `useArenaVote`:

```typescript
export function useArenaMatchup(customPrompt?: string) {
  const url = customPrompt
    ? `${api.arena.getMatchup.path}?prompt=${encodeURIComponent(customPrompt)}`
    : api.arena.getMatchup.path;

  return useQuery({
    queryKey: [api.arena.getMatchup.path, customPrompt ?? ""],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 400) return null;
        throw new Error("Failed to fetch matchup");
      }
      return api.arena.getMatchup.responses[200].parse(await res.json());
    },
    refetchOnWindowFocus: false,
    enabled: true,
  });
}
```

Remove `onSettled: () => setVotedFor(null)` from `useArenaVote` and remove the auto-invalidate of matchup on vote success — the user now controls when to load the next battle:

```typescript
export function useArenaVote() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: z.infer<typeof api.arena.vote.input>) => {
      const res = await fetch(api.arena.vote.path, {
        method: api.arena.vote.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to submit vote");
      return api.arena.vote.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      // Invalidate leaderboard but NOT matchup — user clicks "Next Battle" manually
      queryClient.invalidateQueries({ queryKey: [api.arena.leaderboard.path] });
      toast({ title: "Vote recorded", duration: 1500 });
    },
  });
}
```

- [ ] **Step 2: Rewrite `client/src/pages/Arena.tsx`**

```tsx
import { useArenaMatchup, useArenaVote } from "@/hooks/use-arena";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Swords, RefreshCw, Trophy, Skull, Send } from "lucide-react";
import { useState, useRef } from "react";

export default function Arena() {
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [activePrompt, setActivePrompt] = useState<string | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [votedFor, setVotedFor] = useState<'model_a' | 'model_b' | 'tie' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: matchup, isLoading, isRefetching, refetch } = useArenaMatchup(activePrompt);
  const voteMutation = useArenaVote();

  const handleVote = (winner: 'model_a' | 'model_b' | 'tie') => {
    if (!matchup || revealed) return;
    setVotedFor(winner);
    setRevealed(true);
    voteMutation.mutate({
      modelAId: matchup.modelA.id,
      modelBId: matchup.modelB.id,
      prompt: matchup.prompt,
      winner,
    });
  };

  const handleNextBattle = () => {
    setRevealed(false);
    setVotedFor(null);
    setCustomPrompt("");
    setActivePrompt(undefined);
    refetch();
  };

  const handleSubmitCustomPrompt = () => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    setRevealed(false);
    setVotedFor(null);
    setActivePrompt(trimmed);
  };

  if (isLoading || isRefetching) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] space-y-4">
        <Swords className="w-16 h-16 text-primary animate-bounce" />
        <h2 className="text-xl font-bold animate-pulse text-gradient">Preparing battle...</h2>
      </div>
    );
  }

  if (!matchup) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto space-y-6">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center ring-1 ring-white/10">
          <Skull className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">Not Enough Contenders</h2>
        <p className="text-muted-foreground">
          The arena requires at least two discovered models to begin pairwise evaluation.
        </p>
        <Button onClick={() => window.location.href = '/models'}>Discover Models</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg shadow-lg shadow-red-500/20">
            <Swords className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Arena</h1>
            <p className="text-sm text-muted-foreground">Blind side-by-side evaluation</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => window.location.href = '/leaderboard'} className="gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" /> Leaderboard
          </Button>
          {revealed && (
            <Button onClick={handleNextBattle} className="gap-2">
              <RefreshCw className="w-4 h-4" /> Next Battle
            </Button>
          )}
        </div>
      </div>

      {/* Custom Prompt Input */}
      <div className="flex gap-2 flex-shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmitCustomPrompt()}
          placeholder="Type your own prompt, or leave blank for a random one..."
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button variant="outline" onClick={handleSubmitCustomPrompt} disabled={!customPrompt.trim()} className="gap-2">
          <Send className="w-4 h-4" /> Submit
        </Button>
      </div>

      {/* Prompt Display */}
      <Card className="flex-shrink-0 bg-gradient-to-br from-indigo-950/40 to-slate-900/80 border-indigo-500/20">
        <div className="p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-3">Prompt</h3>
          <p className="text-lg font-medium leading-relaxed">{matchup.prompt}</p>
        </div>
      </Card>

      {/* Responses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Model A */}
        <Card className="flex flex-col h-full bg-white/[0.02] border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-between items-center">
            {revealed ? (
              <span className="font-mono font-bold text-primary">{matchup.modelA.name}</span>
            ) : (
              <span className="font-mono font-bold text-muted-foreground">Model A</span>
            )}
            {revealed && votedFor === 'model_a' && (
              <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full ring-1 ring-green-500/20">Your pick</span>
            )}
          </div>
          <div className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
            {matchup.outputA}
          </div>
          <div className="p-4 bg-black/40 border-t border-white/5 mt-auto">
            <Button
              className="w-full text-lg h-14"
              onClick={() => handleVote('model_a')}
              disabled={revealed}
              variant={votedFor === 'model_a' ? 'primary' : 'glass'}
            >
              {revealed && votedFor === 'model_a' ? '✓ Voted A' : '👈 Winner A'}
            </Button>
          </div>
        </Card>

        {/* Model B */}
        <Card className="flex flex-col h-full bg-white/[0.02] border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-between items-center">
            {revealed ? (
              <span className="font-mono font-bold text-primary">{matchup.modelB.name}</span>
            ) : (
              <span className="font-mono font-bold text-muted-foreground">Model B</span>
            )}
            {revealed && votedFor === 'model_b' && (
              <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full ring-1 ring-green-500/20">Your pick</span>
            )}
          </div>
          <div className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
            {matchup.outputB}
          </div>
          <div className="p-4 bg-black/40 border-t border-white/5 mt-auto">
            <Button
              className="w-full text-lg h-14"
              onClick={() => handleVote('model_b')}
              disabled={revealed}
              variant={votedFor === 'model_b' ? 'primary' : 'glass'}
            >
              {revealed && votedFor === 'model_b' ? '✓ Voted B' : 'Winner B 👉'}
            </Button>
          </div>
        </Card>
      </div>

      {/* Tie / Next */}
      <div className="flex justify-center flex-shrink-0 pt-2 gap-4">
        {!revealed ? (
          <Button
            variant="outline"
            size="lg"
            className="w-48 border-dashed border-2 hover:bg-white/5"
            onClick={() => handleVote('tie')}
          >
            🤝 It's a Tie
          </Button>
        ) : (
          <Button size="lg" className="w-48 gap-2" onClick={handleNextBattle}>
            <RefreshCw className="w-4 h-4" /> Next Battle
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "client/src/components/ui"
```

Expected: No new errors.

- [ ] **Step 4: Smoke test**

Start `npm run dev`. Go to Arena:
- [ ] Model names show as "Model A" / "Model B" before voting
- [ ] After voting, model names are revealed in the header with "Your pick" badge
- [ ] "Next Battle" button appears after voting — model names stay visible until clicked
- [ ] Custom prompt input: type a prompt, press Enter or Submit → new matchup uses that prompt
- [ ] Tie button works, reveals both names

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/use-arena.ts client/src/pages/Arena.tsx
git commit -m "feat: Arena model reveal after vote, user-submitted custom prompts"
```

---

## Chunk 9: Scoring Layer — ROUGE + LLM-as-Judge

### Task 17: ROUGE scoring

**Files:**
- Create: `backend/scoring/__init__.py` (empty)
- Create: `backend/scoring/rouge.py`
- Modify: `requirements.txt` — add `rouge-score`
- Create: `tests/test_scoring.py`

- [ ] **Step 1: Add `rouge-score` to `requirements.txt`**

```
rouge-score==0.1.2
```

Install: `pip install rouge-score`

- [ ] **Step 2: Write failing tests**

```python
# tests/test_scoring.py
import pytest
from backend.scoring.rouge import score_rouge


def test_rouge_perfect_match():
    result = score_rouge("The cat sat on the mat.", "The cat sat on the mat.")
    assert result["rouge1"] == pytest.approx(1.0)
    assert result["rouge2"] == pytest.approx(1.0)
    assert result["rougeL"] == pytest.approx(1.0)


def test_rouge_no_overlap():
    result = score_rouge("The cat sat on the mat.", "Dogs love playing fetch outside.")
    assert result["rouge1"] == pytest.approx(0.0, abs=0.1)


def test_rouge_partial_overlap():
    result = score_rouge("The cat sat on the mat.", "The cat is on the floor.")
    assert 0.0 < result["rouge1"] < 1.0


def test_rouge_returns_all_keys():
    result = score_rouge("hello world", "hello earth")
    assert set(result.keys()) == {"rouge1", "rouge2", "rougeL"}
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_scoring.py -v
```

- [ ] **Step 4: Create `backend/scoring/rouge.py`**

```python
# backend/scoring/rouge.py
from rouge_score import rouge_scorer as rs


_SCORER = rs.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=True)


def score_rouge(prediction: str, reference: str) -> dict[str, float]:
    """
    Returns ROUGE-1, ROUGE-2, ROUGE-L F1 scores in [0, 1].
    Both inputs are plain text strings.
    """
    scores = _SCORER.score(reference, prediction)
    return {
        "rouge1": round(scores["rouge1"].fmeasure, 4),
        "rouge2": round(scores["rouge2"].fmeasure, 4),
        "rougeL": round(scores["rougeL"].fmeasure, 4),
    }
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_scoring.py -v
```

Expected: All 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/scoring/ tests/test_scoring.py requirements.txt
git commit -m "feat: ROUGE-1/2/L scoring via rouge-score"
```

---

### Task 18: LLM-as-Judge

**Files:**
- Create: `backend/scoring/llm_judge.py`
- Modify: `tests/test_scoring.py` — add judge tests

LLM-as-judge sends a structured grading prompt to any provider (Ollama by default, OpenAI when available). Returns a numeric score 1-5 plus a rationale string.

- [ ] **Step 1: Write failing tests**

```python
# Append to tests/test_scoring.py
from unittest.mock import patch, AsyncMock
from backend.scoring.llm_judge import llm_judge_score, build_judge_prompt


def test_build_judge_prompt_contains_key_parts():
    prompt = build_judge_prompt(
        question="What is 2+2?",
        response="The answer is 4.",
        reference="4",
    )
    assert "2+2" in prompt
    assert "The answer is 4" in prompt
    assert "4" in prompt
    assert "1" in prompt and "5" in prompt  # scale mentioned


@pytest.mark.asyncio
async def test_llm_judge_parses_score():
    mock_generate = AsyncMock(return_value={
        "ok": True,
        "response": "SCORE: 4\nRATIONALE: The response is correct and clear."
    })
    with patch("backend.scoring.llm_judge.get_provider") as mock_registry:
        mock_provider = AsyncMock()
        mock_provider.generate = mock_generate
        mock_registry.return_value = mock_provider
        result = await llm_judge_score(
            question="What is 2+2?",
            response="The answer is 4.",
            reference="4",
        )
    assert result["score"] == 4
    assert "correct" in result["rationale"].lower()


@pytest.mark.asyncio
async def test_llm_judge_returns_none_on_parse_failure():
    mock_generate = AsyncMock(return_value={"ok": True, "response": "I cannot score this."})
    with patch("backend.scoring.llm_judge.get_provider") as mock_registry:
        mock_provider = AsyncMock()
        mock_provider.generate = mock_generate
        mock_registry.return_value = mock_provider
        result = await llm_judge_score("q", "r", "ref")
    assert result["score"] is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_scoring.py -k "judge" -v
```

- [ ] **Step 3: Create `backend/scoring/llm_judge.py`**

```python
# backend/scoring/llm_judge.py
"""
LLM-as-a-Judge: uses any provider to grade a model's response
on a 1-5 scale given a question and reference answer.

Score meanings:
  1 = Completely wrong / irrelevant
  2 = Partially correct, major errors
  3 = Mostly correct, minor errors or gaps
  4 = Correct and clear
  5 = Perfect — correct, concise, well-reasoned
"""
import re
from typing import Optional
from backend.providers.registry import get_provider

JUDGE_MODEL = "llama3:8b"  # override via env or config later
JUDGE_PROVIDER = "ollama"


def build_judge_prompt(question: str, response: str, reference: str) -> str:
    return f"""You are an impartial evaluator grading an AI response.

Question: {question}

Reference answer: {reference}

Model response: {response}

Grade the model response on a scale of 1 to 5:
  1 = Completely wrong or irrelevant
  2 = Partially correct, major errors
  3 = Mostly correct, minor errors
  4 = Correct and clear
  5 = Perfect — correct, concise, well-reasoned

Respond in this exact format:
SCORE: <number>
RATIONALE: <one sentence>"""


async def llm_judge_score(
    question: str,
    response: str,
    reference: str,
    model: str = JUDGE_MODEL,
    provider_id: str = JUDGE_PROVIDER,
) -> dict:
    """
    Returns: { score: int|None, rationale: str, raw: str }
    score is None if the judge response could not be parsed.
    """
    provider = get_provider(provider_id)
    prompt = build_judge_prompt(question, response, reference)
    result = await provider.generate(model, prompt)

    if not result["ok"]:
        return {"score": None, "rationale": "", "raw": result.get("error", "")}

    raw = result["response"]
    score_match = re.search(r"SCORE:\s*([1-5])", raw)
    rationale_match = re.search(r"RATIONALE:\s*(.+)", raw)

    score = int(score_match.group(1)) if score_match else None
    rationale = rationale_match.group(1).strip() if rationale_match else ""

    return {"score": score, "rationale": rationale, "raw": raw}
```

- [ ] **Step 4: Run full scoring tests**

```bash
pytest tests/test_scoring.py -v
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend/scoring/llm_judge.py tests/test_scoring.py
git commit -m "feat: LLM-as-judge scoring with structured 1-5 scale and rationale"
```

---

## Chunk 10: Benchmark Scaffold

### Task 19: Abstract Benchmark base + MMLU

**Files:**
- Create: `backend/benchmarks/__init__.py` (empty)
- Create: `backend/benchmarks/base.py`
- Create: `backend/benchmarks/mmlu.py`
- Modify: `requirements.txt` — add `datasets`
- Create: `tests/test_benchmarks.py`

**Design:** Each benchmark knows how to load its data, format a prompt, and evaluate a response. The eval runner (built later) iterates over benchmark items, calls a provider, and scores with `evaluate_response()`.

- [ ] **Step 1: Add `datasets` to `requirements.txt`**

```
datasets==3.1.0
```

Install: `pip install datasets`

- [ ] **Step 2: Write failing tests**

```python
# tests/test_benchmarks.py
import pytest
from backend.benchmarks.base import BenchmarkItem
from backend.benchmarks.mmlu import MMLUBenchmark


def test_benchmark_item_is_dataclass():
    item = BenchmarkItem(
        id="test_1",
        prompt="What is 2+2?",
        reference_answer="4",
        metadata={"subject": "math"},
    )
    assert item.id == "test_1"
    assert item.reference_answer == "4"


def test_mmlu_format_prompt():
    bench = MMLUBenchmark()
    raw = {
        "question": "What is the powerhouse of the cell?",
        "choices": ["Nucleus", "Mitochondria", "Ribosome", "Golgi"],
        "answer": 1,
        "subject": "biology",
    }
    item = bench.item_from_raw(raw, "bio_1")
    assert "Mitochondria" in item.prompt
    assert "B" in item.prompt  # letter choices


def test_mmlu_evaluate_correct_letter():
    bench = MMLUBenchmark()
    raw = {"question": "Q?", "choices": ["A", "B", "C", "D"], "answer": 1, "subject": "test"}
    item = bench.item_from_raw(raw, "q1")
    # Answer index 1 = "B"
    correct, meta = bench.evaluate_response("B", item)
    assert correct is True


def test_mmlu_evaluate_wrong_letter():
    bench = MMLUBenchmark()
    raw = {"question": "Q?", "choices": ["A", "B", "C", "D"], "answer": 1, "subject": "test"}
    item = bench.item_from_raw(raw, "q1")
    correct, meta = bench.evaluate_response("A", item)
    assert correct is False


def test_mmlu_evaluate_fallback_text_match():
    bench = MMLUBenchmark()
    raw = {"question": "Q?", "choices": ["Paris", "London", "Berlin", "Rome"], "answer": 0, "subject": "test"}
    item = bench.item_from_raw(raw, "q1")
    # Response doesn't contain a letter but contains the correct text
    correct, meta = bench.evaluate_response("The answer is Paris, the capital of France.", item)
    assert correct is True
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_benchmarks.py -v
```

- [ ] **Step 4: Create `backend/benchmarks/base.py`**

```python
# backend/benchmarks/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BenchmarkItem:
    id: str
    prompt: str
    reference_answer: str
    metadata: dict[str, Any] = field(default_factory=dict)


class Benchmark(ABC):
    """
    Abstract base for all benchmarks.

    Subclasses implement:
      - item_from_raw(raw, id) → BenchmarkItem
      - evaluate_response(response, item) → (correct: bool, metadata: dict)
      - load_items(max_samples) → list[BenchmarkItem]  (optional override)
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name, e.g. 'MMLU'"""

    @abstractmethod
    def item_from_raw(self, raw: dict, item_id: str) -> BenchmarkItem:
        """Convert a raw dataset row into a BenchmarkItem."""

    @abstractmethod
    def evaluate_response(self, response: str, item: BenchmarkItem) -> tuple[bool, dict]:
        """
        Returns (correct, metadata).
        correct: whether the response is considered right.
        metadata: any extra info (extracted letter, matched text, etc.)
        """

    def load_items(self, max_samples: int = 100) -> list[BenchmarkItem]:
        """
        Load benchmark items. Override to pull from HuggingFace datasets.
        Default returns empty list (for stubs/testing).
        """
        return []
```

- [ ] **Step 5: Create `backend/benchmarks/mmlu.py`**

```python
# backend/benchmarks/mmlu.py
"""
MMLU (Massive Multitask Language Understanding) benchmark.
57 subjects, 14,042 test questions. Loaded from HuggingFace datasets.

Two-stage answer evaluation (inspired by llm-evaluation repo):
  1. Extract letter (A/B/C/D) from response
  2. Fall back to substring match of the correct choice text
"""
import re
from backend.benchmarks.base import Benchmark, BenchmarkItem

LETTERS = ["A", "B", "C", "D"]


class MMLUBenchmark(Benchmark):

    @property
    def name(self) -> str:
        return "MMLU"

    def item_from_raw(self, raw: dict, item_id: str) -> BenchmarkItem:
        choices = raw["choices"]
        choices_text = "\n".join(f"{LETTERS[i]}. {c}" for i, c in enumerate(choices))
        prompt = f"{raw['question']}\n\n{choices_text}\n\nAnswer with a single letter (A, B, C, or D)."
        correct_letter = LETTERS[raw["answer"]]
        return BenchmarkItem(
            id=item_id,
            prompt=prompt,
            reference_answer=correct_letter,
            metadata={
                "subject": raw.get("subject", ""),
                "choices": choices,
                "correct_index": raw["answer"],
            },
        )

    def evaluate_response(self, response: str, item: BenchmarkItem) -> tuple[bool, dict]:
        correct_letter = item.reference_answer
        correct_index = item.metadata["correct_index"]
        choices = item.metadata["choices"]

        # Stage 1: extract letter
        letter_match = re.search(r"\b([A-D])\b", response.upper())
        if letter_match:
            extracted = letter_match.group(1)
            correct = extracted == correct_letter
            return correct, {"method": "letter_extraction", "extracted": extracted}

        # Stage 2: substring match
        correct_text = choices[correct_index].lower()
        response_lower = response.lower()

        # Make sure no wrong answer text appears before checking the right one
        wrong_texts = [choices[i].lower() for i in range(len(choices)) if i != correct_index]
        has_wrong = any(w in response_lower for w in wrong_texts if len(w) > 3)
        has_correct = correct_text.lower() in response_lower

        if has_correct and not has_wrong:
            return True, {"method": "text_match", "matched": correct_text}

        return False, {"method": "no_match"}

    def load_items(self, max_samples: int = 100) -> list[BenchmarkItem]:
        """
        Load MMLU test items from HuggingFace.
        Requires: pip install datasets
        Downloads ~100MB on first call, cached afterwards.
        """
        try:
            from datasets import load_dataset
            ds = load_dataset("cais/mmlu", "all", split="test", streaming=True)
            items = []
            for i, row in enumerate(ds):
                if i >= max_samples:
                    break
                items.append(self.item_from_raw(row, f"mmlu_{i}"))
            return items
        except Exception as e:
            raise RuntimeError(f"Failed to load MMLU dataset: {e}") from e
```

- [ ] **Step 6: Run benchmark tests**

```bash
pytest tests/test_benchmarks.py -v
```

Expected: All 5 pass (no network calls needed — `load_items` is not tested here).

- [ ] **Step 7: Commit**

```bash
git add backend/benchmarks/ tests/test_benchmarks.py requirements.txt
git commit -m "feat: benchmark scaffold — abstract base + MMLU with two-stage answer validation"
```

---

## Complete File Map (all files after all chunks)

```
backend/
  __init__.py
  main.py                    # FastAPI app, CORS, lifespan, router registration
  database.py                # SQLAlchemy engine, Base, get_db
  models.py                  # ORM table definitions
  schemas.py                 # Pydantic request/response schemas (camelCase)
  providers/
    __init__.py
    base.py                  # Abstract LLMProvider
    ollama.py                # Ollama implementation
    openai_provider.py       # OpenAI stub
    registry.py              # Provider factory
  routers/
    __init__.py
    ollama.py                # GET /api/ollama/status
    models.py                # GET /api/models, POST /api/models/discover
    arena.py                 # GET /api/arena/matchup?prompt=, POST /api/arena/vote, GET /api/arena/leaderboard
    eval_runs.py             # CRUD for eval runs
    datasets.py              # GET /api/datasets
  services/
    __init__.py
    storage.py               # All DB operations
  scoring/
    __init__.py
    rouge.py                 # ROUGE-1/2/L
    llm_judge.py             # LLM-as-judge (1-5 scale + rationale)
  benchmarks/
    __init__.py
    base.py                  # Abstract Benchmark + BenchmarkItem
    mmlu.py                  # MMLU (57 subjects, two-stage validation)

tests/
  __init__.py
  conftest.py                # In-memory DB, TestClient fixtures
  test_database.py
  test_ollama_service.py
  test_ollama_router.py
  test_models_router.py
  test_arena_router.py
  test_providers.py
  test_scoring.py
  test_benchmarks.py

shared/
  routes.ts                  # Pure Zod schemas + API path constants (no Drizzle)

client/
  src/
    hooks/
      use-arena.ts           # useArenaMatchup(prompt?), useArenaVote, useArenaLeaderboard
    pages/
      Arena.tsx              # Reveal state, custom prompt input, model names after vote

requirements.txt
```

---

## What This Unlocks Going Forward

With this foundation, the next phases are straightforward Python additions:

```python
# Phase 2: More scoring
from bert_score import score as bert_score    # Semantic similarity
import evaluate                               # HuggingFace Evaluate hub (BLEU, etc.)

# Phase 2: More providers
from backend.providers.anthropic_provider import AnthropicProvider  # Claude
from backend.providers.gemini_provider import GeminiProvider        # Gemini

# Phase 3: More benchmarks
from backend.benchmarks.truthfulqa import TruthfulQABenchmark
from backend.benchmarks.gsm8k import GSM8KBenchmark                 # Math
from backend.benchmarks.custom import CustomDatasetBenchmark        # User uploads

# Phase 4: Eval runner (wires benchmarks + providers + scoring)
from backend.services.eval_runner import EvalRunner
runner = EvalRunner(provider=OllamaProvider(), benchmark=MMLUBenchmark(), scorer=llm_judge_score)
results = await runner.run(model="llama3:8b", max_samples=50)
```
