"""
Security utilities — Fernet symmetric encryption for sensitive settings
(API keys) stored in evalbench.db.

Encryption key lifecycle:
  - First run: a fresh Fernet key is generated and written to ~/.evalbench_key  (chmod 600)
  - Subsequent runs: the key is read from that file
  - If the file is lost, encrypted values become unreadable and must be re-entered.
    Non-sensitive settings (ollama_host, judge_model) are stored unencrypted
    and are never affected.

Environment override:
  Set EVALBENCH_SECRET_KEY_FILE=/path/to/key to use a custom key location.
"""
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Keys that contain secrets and must be encrypted at rest
SENSITIVE_KEYS: frozenset[str] = frozenset({
    "openai_api_key",
    "anthropic_api_key",
    "gemini_api_key",
    "groq_api_key",
    "grok_api_key",   # legacy name kept for backward compat
    "huggingface_token",
})

# Prefix written into DB to distinguish encrypted from legacy plaintext values
_ENCRYPTED_PREFIX = "enc:v1:"


def _get_key_path() -> Path:
    env_path = os.getenv("EVALBENCH_SECRET_KEY_FILE")
    if env_path:
        return Path(env_path)
    return Path.home() / ".evalbench_key"


def _load_or_create_fernet():
    """
    Lazily import cryptography so startup doesn't fail if not installed.
    Returns a Fernet instance, or None if the library is unavailable.
    """
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        logger.warning(
            "cryptography library not installed — API keys will be stored unencrypted. "
            "Run `uv add cryptography` to enable encryption."
        )
        return None

    key_path = _get_key_path()

    if key_path.exists():
        key = key_path.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        key_path.write_bytes(key)
        key_path.chmod(0o600)  # owner read/write only
        logger.info(f"Generated new encryption key at {key_path}")

    return Fernet(key)


# Module-level cached instance (None = unavailable)
_fernet = None
_fernet_loaded = False


def _get_fernet():
    global _fernet, _fernet_loaded
    if not _fernet_loaded:
        _fernet = _load_or_create_fernet()
        _fernet_loaded = True
    return _fernet


def encrypt_value(plaintext: str) -> str:
    """
    Encrypt a plaintext string. Returns an `enc:v1:...` prefixed ciphertext.
    If encryption is unavailable, returns the plaintext unchanged (with warning).
    """
    if not plaintext:
        return plaintext
    f = _get_fernet()
    if f is None:
        return plaintext
    ciphertext = f.encrypt(plaintext.encode()).decode()
    return f"{_ENCRYPTED_PREFIX}{ciphertext}"


def decrypt_value(stored: str) -> str:
    """
    Decrypt a stored value. Handles three cases:
      1. Starts with `enc:v1:` — decrypt it.
      2. No prefix — legacy plaintext, return as-is (so old values still work).
      3. Empty / None — return unchanged.
    """
    if not stored:
        return stored
    if not stored.startswith(_ENCRYPTED_PREFIX):
        # Legacy plaintext — still readable, will be encrypted on next save
        return stored
    f = _get_fernet()
    if f is None:
        logger.error("Cannot decrypt value — cryptography library unavailable.")
        return ""
    try:
        ciphertext = stored[len(_ENCRYPTED_PREFIX):]
        return f.decrypt(ciphertext.encode()).decode()
    except Exception as e:
        logger.error(f"Failed to decrypt setting value: {e}")
        return ""


def is_sensitive(key: str) -> bool:
    """Return True if this settings key should be encrypted at rest."""
    return key in SENSITIVE_KEYS
