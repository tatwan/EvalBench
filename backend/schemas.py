from datetime import datetime
from typing import Any, Optional, Literal
from pydantic import BaseModel, ConfigDict, Field
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

TaskType = Literal[
    "summarization",
    "qa",
    "chat",
    "translation",
    "code",
    "reasoning",
    "knowledge",
    "embedding",
    "classification",
    "safety",
]


class EvalRunConfig(CamelModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        protected_namespaces=(),
        extra="allow",
    )

    model_ids: list[int] = Field(default_factory=list)
    task_type: TaskType = "qa"
    benchmark_keys: list[str] = Field(default_factory=list)
    dataset_id: Optional[int] = Field(default=None, gt=0)
    dataset_item_count: Optional[int] = Field(default=None, ge=0)
    total_pairs: Optional[int] = Field(default=None, ge=0)
    completed_pairs: Optional[int] = Field(default=None, ge=0)
    error_count: Optional[int] = Field(default=None, ge=0)
    retry_count: Optional[int] = Field(default=None, ge=0)
    cache_hits: Optional[int] = Field(default=None, ge=0)
    duration_seconds: Optional[float] = Field(default=None, ge=0)
    cancel_requested: Optional[bool] = None
    errors: list[str] = Field(default_factory=list)

class EvalRunOut(CamelModel):
    id: int
    timestamp: Optional[datetime] = None
    config_json: EvalRunConfig
    status: str


class EvalRunCreate(CamelModel):
    model_ids: list[int] = Field(min_length=1)
    task_type: TaskType = "qa"
    benchmark_keys: list[str] = Field(default_factory=list)  # legacy compat
    dataset_id: Optional[int] = Field(default=None, gt=0)


class EvalResultOut(CamelModel):
    id: int
    run_id: int
    model_id: int
    metric_name: str
    score: float
    error: bool = False
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


class SettingConnectionTestIn(CamelModel):
    target: Literal["ollama", "judge", "openai", "anthropic", "gemini", "groq", "grok"]
    ollama_host: str | None = None
    judge_model: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    grok_api_key: str | None = None


class SettingConnectionTestOut(CamelModel):
    target: str
    ok: bool
    message: str
    details: str | None = None


# --- Run Schemas ---

class GoldenDatasetOut(CamelModel):
    id: int
    name: str
    source: Optional[str] = None
    created_at: Optional[datetime] = None
    schema_version: Optional[int] = None
    item_count: int = 0


class GoldenItemIn(CamelModel):
    input: str = Field(min_length=1)
    expected_output: str = Field(min_length=1)
    context: Optional[str] = None
    tags: Any = None
    difficulty: Optional[str] = None


class GoldenItemOut(CamelModel):
    id: int
    dataset_id: int
    input: str
    expected_output: str
    context: Optional[str] = None
    tags: Any = None
    difficulty: Optional[str] = None


class GoldenDatasetDetailOut(GoldenDatasetOut):
    items: list[GoldenItemOut]


class GoldenDatasetCreate(CamelModel):
    name: str = Field(min_length=1)
    source: Optional[str] = None
    items: list[GoldenItemIn] = Field(min_length=1)


class GoldenDatasetImport(CamelModel):
    name: str = Field(min_length=1)
    source: Optional[str] = None
    format: Literal["json", "csv"]
    content: str = Field(min_length=1)


class GoldenDatasetImportPreviewOut(CamelModel):
    count: int
    items: list[GoldenItemIn]


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
    winner: Literal["model_a", "model_b", "tie"]


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
