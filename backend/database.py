from sqlalchemy import create_engine, DateTime, String, TypeDecorator
from sqlalchemy.orm import sessionmaker, DeclarativeBase
import os
import sqlite3
from datetime import datetime, timezone


class FlexibleDateTime(TypeDecorator):
    """
    Stores datetimes as ISO strings in SQLite.
    Handles both Python datetime objects and existing string timestamps
    already written by the old Drizzle/Node backend.
    """
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
            return value.isoformat()
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        try:
            # Handle both "2024-01-01T12:00:00" and "2024-01-01 12:00:00" formats
            parsed = datetime.fromisoformat(str(value).replace(" ", "T"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except (ValueError, TypeError):
            return None


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./evalbench.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False,
        "detect_types": sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES,
    },
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
