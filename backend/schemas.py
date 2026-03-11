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
        protected_namespaces=(),  # suppress model_ prefix warnings on field names
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


class EvalRunCreate(CamelModel):
    model_ids: list[int]
    task_type: str = "qa"          # summarization | qa | chat | translation | code | reasoning | knowledge | embedding
    benchmark_keys: list[str] = []  # legacy compat
    dataset_id: Optional[int] = None


class EvalResultOut(CamelModel):
    id: int
    run_id: int
    model_id: int
    metric_name: str
    score: float
    raw_output: Optional[str] = None
    item_id: Optional[int] = None
    timestamp: datetime | None = None

# --- Settings ---
class SettingBase(CamelModel):
    key: str
    value: str | None = None

class SettingOut(SettingBase):
    pass

class SettingUpdate(CamelModel):
    value: str | None = None


# --- Run Schemas ---

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


class ArenaVoteIn(CamelModel):
    model_a_id: int
    model_b_id: int
    prompt: str
    winner: str  # 'model_a', 'model_b', 'tie'


class EloRatingOut(CamelModel):
    model_id: int
    rating: int
    games_played: int
    last_updated: Optional[datetime] = None


class LeaderboardEntry(CamelModel):
    model: ModelOut
    rating: EloRatingOut


class ArenaMatchupOut(CamelModel):
    prompt: str
    model_a: ModelOut
    model_b: ModelOut
    output_a: str
    output_b: str


# --- Ollama ---

class OllamaStatusOut(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    running: bool
    model_count: int
    error: Optional[str] = None
