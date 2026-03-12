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

## Post-Migration: What Python Unlocks

Once this migration is complete, the following become straightforward to add directly in the backend — no sidecar needed:

```python
# Future eval metrics — all native Python, drop into backend/services/
from rouge_score import rouge_scorer          # ROUGE-1/2/L
from bert_score import score as bert_score    # BERTScore
import evaluate                               # HuggingFace Evaluate hub
from huggingface_hub import InferenceClient  # HF model inference
from datasets import load_dataset            # HF datasets
from transformers import pipeline            # local HF models
```
