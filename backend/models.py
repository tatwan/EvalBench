from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Text, ForeignKey, JSON, Boolean, Index
)
from sqlalchemy.sql import func
from backend.database import Base, FlexibleDateTime



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
    name = Column(String, nullable=True) # E17
    timestamp = Column(FlexibleDateTime, server_default=func.now(), default=lambda: datetime.now(timezone.utc)) # B8
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    config_json = Column(JSON, nullable=True)  # Store criteria, taskType, etc.


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String(100), primary_key=True, index=True)
    value = Column(String(1000), nullable=True)


class EvalResult(Base):
    __tablename__ = "eval_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("eval_runs.id"), nullable=False)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    metric_name = Column(String, nullable=False)
    score = Column(Float, nullable=False)
    error = Column(Boolean, default=False, nullable=False)
    raw_output = Column(Text, nullable=True)
    item_id = Column(Integer, ForeignKey("golden_items.id"), nullable=True, index=True) # E14

    __table_args__ = (
        Index("ix_eval_results_run_model_metric", "run_id", "model_id", "metric_name"), # E15
    )


class GoldenDataset(Base):
    __tablename__ = "golden_datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=True)
    created_at = Column(FlexibleDateTime, default=lambda: datetime.now(timezone.utc))
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
    metadata_ = Column("metadata", JSON, nullable=True) # E16 (using metadata_ for the property since metadata is reserved by SQLAlchemy Base)


class ArenaBattle(Base):
    __tablename__ = "arena_battles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_a_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    model_b_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    prompt = Column(Text, nullable=False)
    winner = Column(String, nullable=False)  # 'model_a', 'model_b', 'tie'
    timestamp = Column(FlexibleDateTime, default=lambda: datetime.now(timezone.utc))


class EloRating(Base):
    __tablename__ = "elo_ratings"

    model_id = Column(Integer, ForeignKey("models.id"), primary_key=True)
    rating = Column(Integer, nullable=False, default=1200)
    games_played = Column(Integer, nullable=False, default=0)
    last_updated = Column(FlexibleDateTime, default=lambda: datetime.now(timezone.utc))


class ResponseCache(Base):
    __tablename__ = "response_cache"

    key = Column(String(64), primary_key=True)  # SHA256 of model_name + prompt
    response = Column(Text, nullable=False)
    eval_count = Column(Integer, nullable=True)
    eval_duration = Column(Integer, nullable=True)
    created_at = Column(FlexibleDateTime, default=lambda: datetime.now(timezone.utc))
