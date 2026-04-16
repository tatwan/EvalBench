from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import List

from backend.database import get_db
from backend.models import Setting, EvalRun, EvalResult, ArenaBattle, EloRating, ResponseCache
from backend.schemas import (
    SettingConnectionTestIn,
    SettingConnectionTestOut,
    SettingOut,
    SettingUpdate,
)
from backend.security import encrypt_value, decrypt_value, is_sensitive
from backend.services.ollama import check_status, invalidate_host_cache

router = APIRouter(prefix="/api/settings", tags=["settings"])

EVAL_PROVIDERS = ("openai", "anthropic", "gemini", "groq", "grok")


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


def _current_settings(db: Session) -> dict[str, str]:
    settings: dict[str, str] = {}
    for setting in db.query(Setting).all():
        value = setting.value or ""
        settings[setting.key] = decrypt_value(value) if is_sensitive(setting.key) else value
    return settings


def _provider_for_judge_model(judge_model: str) -> str:
    if judge_model.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-", "text-embedding-")):
        return "openai"
    if judge_model.startswith("claude-"):
        return "anthropic"
    if judge_model.startswith("gemini-"):
        return "gemini"
    if judge_model.startswith("grok-"):
        return "grok"
    if judge_model.startswith("groq-"):
        return "groq"
    return "ollama"


def _capabilities_for_model(model_id: str, generation_methods: list[str] | None = None) -> list[str]:
    lowered = model_id.lower()
    capabilities: list[str] = []
    methods = {method.lower() for method in generation_methods or []}
    if any("embed" in method for method in methods) or any(token in lowered for token in ("embed", "embedding", "text-embedding")):
        capabilities.append("embedding")
    if any("generate" in method or "message" in method for method in methods) or not methods:
        if not any(token in lowered for token in ("tts", "whisper", "audio", "image", "realtime", "search", "transcribe")):
            capabilities.append("text")
    return capabilities or ["text"]


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


@router.post("/test-connection", response_model=SettingConnectionTestOut)
async def test_connection(payload: SettingConnectionTestIn, db: Session = Depends(get_db)):
    settings = _current_settings(db)
    overrides = {
        "ollama_host": payload.ollama_host,
        "judge_model": payload.judge_model,
        "openai_api_key": payload.openai_api_key,
        "anthropic_api_key": payload.anthropic_api_key,
        "gemini_api_key": payload.gemini_api_key,
        "groq_api_key": payload.groq_api_key,
        "grok_api_key": payload.grok_api_key,
    }
    for key, value in overrides.items():
        if value is not None:
            settings[key] = value

    target = payload.target
    if target == "ollama":
        host = settings.get("ollama_host", "http://localhost:11434").strip() or "http://localhost:11434"
        result = await check_status(host)
        if result["ok"]:
            return SettingConnectionTestOut(
                target=target,
                ok=True,
                message=f"Ollama is reachable at {host}.",
                details=f"Discovered {result['model_count']} models.",
            )
        return SettingConnectionTestOut(
            target=target,
            ok=False,
            message=f"Could not reach Ollama at {host}.",
            details=result.get("error"),
        )

    provider_key_map = {
        "openai": "openai_api_key",
        "anthropic": "anthropic_api_key",
        "gemini": "gemini_api_key",
        "groq": "groq_api_key",
        "grok": "grok_api_key",
    }

    if target in provider_key_map:
        key_name = provider_key_map[target]
        api_key = (settings.get(key_name) or "").strip()
        if not api_key:
            return SettingConnectionTestOut(
                target=target,
                ok=False,
                message=f"{target.title()} API key is missing.",
                details="Enter a key and test again.",
            )
        format_hints = {
            "openai": api_key.startswith("sk-"),
            "anthropic": api_key.startswith("sk-ant-"),
            "gemini": api_key.startswith("AIza") or len(api_key) >= 20,
            "groq": api_key.startswith("gsk_"),
            "grok": api_key.startswith("xai-") or len(api_key) >= 10,
        }
        format_ok = format_hints.get(target, True)
        return SettingConnectionTestOut(
            target=target,
            ok=format_ok,
            message=(
                f"{target.title()} credentials look ready."
                if format_ok
                else f"{target.title()} API key format looks unusual."
            ),
            details=(
                "Key is present. Live provider ping is skipped in the settings test; the next judge/eval call will use it."
                if format_ok
                else "Double-check the provider key before saving."
            ),
        )

    judge_model = (settings.get("judge_model") or "").strip()
    if not judge_model:
        return SettingConnectionTestOut(
            target=target,
            ok=False,
            message="Judge model is not configured.",
            details="Pick a judge model first, then test the setup again.",
        )

    provider = _provider_for_judge_model(judge_model)
    if provider == "ollama":
        host = settings.get("ollama_host", "http://localhost:11434").strip() or "http://localhost:11434"
        result = await check_status(host)
        return SettingConnectionTestOut(
            target=target,
            ok=result["ok"],
            message=(
                f"Local judge model '{judge_model}' is ready to use through Ollama."
                if result["ok"]
                else f"Judge model '{judge_model}' depends on a reachable Ollama host."
            ),
            details=result.get("error") if not result["ok"] else f"Ollama host: {host}",
        )

    provider_key = provider_key_map[provider]
    if not (settings.get(provider_key) or "").strip():
        return SettingConnectionTestOut(
            target=target,
            ok=False,
            message=f"Judge model '{judge_model}' needs a configured {provider.title()} API key.",
            details=f"Set {provider_key} before using this judge.",
        )

    if provider == "anthropic":
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return SettingConnectionTestOut(
                target=target,
                ok=False,
                message="Anthropic SDK is not installed.",
                details="Install the dependency before using Claude as a judge.",
            )
    else:
        try:
            import openai  # noqa: F401
        except ImportError:
            return SettingConnectionTestOut(
                target=target,
                ok=False,
                message="OpenAI-compatible SDK is not installed.",
                details=f"Install the SDK before using {provider.title()} judge models.",
            )

    return SettingConnectionTestOut(
        target=target,
        ok=True,
        message=f"Judge model '{judge_model}' looks configured correctly.",
        details=f"Provider: {provider.title()}. Live judge requests will use the saved configuration.",
    )

@router.get("/judge-models")
async def get_judge_models(db: Session = Depends(get_db)):
    """
    Fetch available chat/completion models from each configured provider.
    Returns grouped by provider. Falls back to empty list for unconfigured providers.
    """
    import httpx

    # Read decrypted API keys from settings
    all_settings = {s.key: s.value for s in db.query(Setting).all()}

    def _key(name: str) -> str:
        raw = all_settings.get(name, "")
        try:
            return decrypt_value(raw).strip() if raw else ""
        except Exception:
            return raw.strip() if raw else ""

    openai_key    = _key("openai_api_key")
    anthropic_key = _key("anthropic_api_key")
    gemini_key    = _key("gemini_api_key")
    groq_key      = _key("groq_api_key")
    grok_key      = _key("grok_api_key")

    result: dict[str, list[dict]] = {
        "openai": [], "anthropic": [], "gemini": [], "groq": [], "grok": []
    }

    async with httpx.AsyncClient(timeout=8.0) as client:

        # OpenAI
        if openai_key:
            try:
                r = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {openai_key}"},
                )
                if r.status_code == 200:
                    KEEP = ("gpt-", "o1", "o3", "o4", "chatgpt-")
                    SKIP = ("instruct", "tts", "whisper", "dall-e", "embedding", "realtime", "audio", "search", "transcribe")
                    models = sorted(
                        [m for m in r.json().get("data", [])
                         if any(m["id"].startswith(p) for p in KEEP)
                         and not any(s in m["id"] for s in SKIP)],
                        key=lambda m: m.get("created", 0), reverse=True
                    )
                    result["openai"] = [{"id": m["id"], "label": m["id"]} for m in models[:15]]
            except Exception:
                pass

        # Anthropic
        if anthropic_key:
            try:
                r = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={"x-api-key": anthropic_key, "anthropic-version": "2023-06-01"},
                )
                if r.status_code == 200:
                    models = sorted(
                        [m for m in r.json().get("data", []) if not m.get("deprecated_at")],
                        key=lambda m: m.get("created_at", ""), reverse=True
                    )
                    result["anthropic"] = [{"id": m["id"], "label": m.get("display_name", m["id"])} for m in models[:10]]
            except Exception:
                pass

        # Gemini
        if gemini_key:
            try:
                r = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": gemini_key},
                )
                if r.status_code == 200:
                    models = [
                        m for m in r.json().get("models", [])
                        if "generateContent" in m.get("supportedGenerationMethods", [])
                        and m.get("name", "").startswith("models/gemini-")
                    ]
                    result["gemini"] = [
                        {"id": m["name"].replace("models/", ""), "label": m.get("displayName", m["name"].replace("models/", ""))}
                        for m in models[:10]
                    ]
            except Exception:
                pass

        # Groq
        if groq_key:
            try:
                r = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {groq_key}"},
                )
                if r.status_code == 200:
                    SKIP_GROQ = ("whisper", "tts", "guard", "embed")
                    models = [
                        m for m in r.json().get("data", [])
                        if not any(s in m["id"] for s in SKIP_GROQ)
                    ]
                    result["groq"] = [{"id": f"groq-{m['id']}", "label": m["id"]} for m in models[:10]]
            except Exception:
                pass

        # xAI Grok
        if grok_key:
            try:
                r = await client.get(
                    "https://api.x.ai/v1/models",
                    headers={"Authorization": f"Bearer {grok_key}"},
                )
                if r.status_code == 200:
                    models = [
                        m for m in r.json().get("data", [])
                        if not any(token in m["id"] for token in ("audio", "image", "realtime"))
                    ]
                    result["grok"] = [{"id": m["id"], "label": m["id"]} for m in models[:10]]
            except Exception:
                pass

    return result


@router.get("/eval-models")
async def get_eval_models(db: Session = Depends(get_db)):
    """
    Fetch available provider models for use as evaluated cloud/frontier models.
    Includes capability hints so the wizard can separate text vs embedding tasks.
    """
    import httpx

    all_settings = {s.key: s.value for s in db.query(Setting).all()}

    def _key(name: str) -> str:
        raw = all_settings.get(name, "")
        try:
            return decrypt_value(raw).strip() if raw else ""
        except Exception:
            return raw.strip() if raw else ""

    openai_key = _key("openai_api_key")
    anthropic_key = _key("anthropic_api_key")
    gemini_key = _key("gemini_api_key")
    groq_key = _key("groq_api_key")
    grok_key = _key("grok_api_key")

    result: dict[str, list[dict]] = {provider: [] for provider in EVAL_PROVIDERS}

    async with httpx.AsyncClient(timeout=8.0) as client:
        if openai_key:
            try:
                r = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {openai_key}"},
                )
                if r.status_code == 200:
                    SKIP = ("tts", "whisper", "dall-e", "realtime", "audio", "search", "transcribe")
                    models = [
                        m for m in r.json().get("data", [])
                        if not any(token in m["id"] for token in SKIP)
                    ]
                    result["openai"] = [
                        {
                            "id": m["id"],
                            "label": m["id"],
                            "capabilities": _capabilities_for_model(m["id"]),
                        }
                        for m in models[:25]
                    ]
            except Exception:
                pass

        if anthropic_key:
            try:
                r = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={"x-api-key": anthropic_key, "anthropic-version": "2023-06-01"},
                )
                if r.status_code == 200:
                    models = sorted(
                        [m for m in r.json().get("data", []) if not m.get("deprecated_at")],
                        key=lambda m: m.get("created_at", ""),
                        reverse=True,
                    )
                    result["anthropic"] = [
                        {
                            "id": m["id"],
                            "label": m.get("display_name", m["id"]),
                            "capabilities": ["text"],
                        }
                        for m in models[:10]
                    ]
            except Exception:
                pass

        if gemini_key:
            try:
                r = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": gemini_key},
                )
                if r.status_code == 200:
                    models = [m for m in r.json().get("models", []) if m.get("name", "").startswith("models/gemini-")]
                    result["gemini"] = [
                        {
                            "id": m["name"].replace("models/", ""),
                            "label": m.get("displayName", m["name"].replace("models/", "")),
                            "capabilities": _capabilities_for_model(
                                m["name"].replace("models/", ""),
                                m.get("supportedGenerationMethods", []),
                            ),
                        }
                        for m in models[:15]
                    ]
            except Exception:
                pass

        if groq_key:
            try:
                r = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {groq_key}"},
                )
                if r.status_code == 200:
                    SKIP_GROQ = ("whisper", "tts", "guard", "audio")
                    models = [
                        m for m in r.json().get("data", [])
                        if not any(token in m["id"] for token in SKIP_GROQ)
                    ]
                    result["groq"] = [
                        {
                            "id": f"groq-{m['id']}",
                            "label": m["id"],
                            "capabilities": _capabilities_for_model(m["id"]),
                        }
                        for m in models[:15]
                    ]
            except Exception:
                pass

        if grok_key:
            try:
                r = await client.get(
                    "https://api.x.ai/v1/models",
                    headers={"Authorization": f"Bearer {grok_key}"},
                )
                if r.status_code == 200:
                    models = [
                        m for m in r.json().get("data", [])
                        if not any(token in m["id"] for token in ("audio", "image", "realtime"))
                    ]
                    result["grok"] = [
                        {
                            "id": m["id"],
                            "label": m.get("id", ""),
                            "capabilities": _capabilities_for_model(m["id"]),
                        }
                        for m in models[:15]
                    ]
            except Exception:
                pass

    return result


@router.post("/wipe-data")
def wipe_data(db: Session = Depends(get_db)):
    """Permanently delete all evaluation results, runs, battles, elo ratings, and cached responses."""
    db.query(EvalResult).delete()
    db.query(EvalRun).delete()
    db.query(ArenaBattle).delete()
    db.query(EloRating).delete()
    db.query(ResponseCache).delete()
    try:
        db.execute(
            text(
                "DELETE FROM sqlite_sequence "
                "WHERE name IN ('eval_results', 'eval_runs', 'arena_battles')"
            )
        )
    except Exception:
        db.rollback()
        db.query(EvalResult).delete()
        db.query(EvalRun).delete()
        db.query(ArenaBattle).delete()
        db.query(EloRating).delete()
        db.query(ResponseCache).delete()
    db.commit()
    return {"message": "All captured stats, runs, and evals have been permanently deleted."}
