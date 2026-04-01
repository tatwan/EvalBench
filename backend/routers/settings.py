from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.database import get_db
from backend.models import Setting
from backend.schemas import SettingOut, SettingUpdate
from backend.security import encrypt_value, decrypt_value, is_sensitive
from backend.services.ollama import invalidate_host_cache

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _safe_out(setting: Setting) -> dict:
    """
    Return a settings dict suitable for the frontend.
    Sensitive keys are decrypted before sending; the raw DB value is never
    forwarded to the client if it carries the enc:v1: prefix.
    """
    value = setting.value or ""
    if is_sensitive(setting.key):
        value = decrypt_value(value)
    return {"key": setting.key, "value": value}


@router.get("", response_model=List[SettingOut])
def get_all_settings(db: Session = Depends(get_db)):
    """Fetch all global configuration settings (sensitive values are decrypted for the UI)."""
    settings = db.query(Setting).all()
    return [_safe_out(s) for s in settings]


@router.put("/{key}", response_model=SettingOut)
def update_setting(key: str, payload: SettingUpdate, db: Session = Depends(get_db)):
    """Set or update a specific configuration value. API keys are encrypted before storage."""
    raw_value = payload.value or ""

    # Encrypt sensitive keys before writing to DB
    stored_value = encrypt_value(raw_value) if is_sensitive(key) and raw_value else raw_value

    setting = db.query(Setting).filter_by(key=key).first()
    if setting:
        setting.value = stored_value
    else:
        setting = Setting(key=key, value=stored_value)
        db.add(setting)

    db.commit()
    db.refresh(setting)

    # Bust the in-memory host cache when the Ollama URL changes
    if key == "ollama_host":
        invalidate_host_cache()

    # Return decrypted value to frontend so the UI state stays consistent
    return _safe_out(setting)
