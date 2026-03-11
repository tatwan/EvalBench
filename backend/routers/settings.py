from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.database import get_db
from backend.models import Setting
from backend.schemas import SettingOut, SettingUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])

@router.get("", response_model=List[SettingOut])
def get_all_settings(db: Session = Depends(get_db)):
    """Fetch all global configuration settings."""
    settings = db.query(Setting).all()
    return settings

@router.put("/{key}", response_model=SettingOut)
def update_setting(key: str, payload: SettingUpdate, db: Session = Depends(get_db)):
    """Set or update a specific configuration value by its key."""
    setting = db.query(Setting).filter_by(key=key).first()
    
    if setting:
        setting.value = payload.value
    else:
        setting = Setting(key=key, value=payload.value)
        db.add(setting)
        
    db.commit()
    db.refresh(setting)
    return setting
