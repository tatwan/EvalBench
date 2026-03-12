from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Text, ForeignKey, JSON
)
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
    timestamp = Column(FlexibleDateTime, default=datetime.utcnow)
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
    item_id = Column(Integer, ForeignKey("golden_items.id"), nullable=True)


class GoldenDataset(Base):
    __tablename__ = "golden_datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=True)
    created_at = Column(FlexibleDateTime, default=datetime.utcnow)
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
    timestamp = Column(FlexibleDateTime, default=datetime.utcnow)


class EloRating(Base):
    __tablename__ = "elo_ratings"

    model_id = Column(Integer, ForeignKey("models.id"), primary_key=True)
    rating = Column(Integer, nullable=False, default=1200)
    games_played = Column(Integer, nullable=False, default=0)
    last_updated = Column(FlexibleDateTime, default=datetime.utcnow)
