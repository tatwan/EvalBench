"""
METEOR scoring — computed directly with NLTK.
This avoids the fragile evaluate-module cache path while still using the same
underlying metric family for summarization and translation tasks.
"""
import logging
import threading
from nltk.translate.meteor_score import single_meteor_score
from nltk.corpus import wordnet

logger = logging.getLogger(__name__)

_wordnet_lock = threading.Lock()
_wordnet_ready = False


def _ensure_wordnet_ready() -> None:
    global _wordnet_ready
    if _wordnet_ready:
        return
    with _wordnet_lock:
        if _wordnet_ready:
            return
        wordnet.ensure_loaded()
        _wordnet_ready = True

def _tokenize(text: str) -> list[str]:
    return [token for token in text.strip().split() if token]


def warm_up() -> None:
    """METEOR uses NLTK assets already downloaded at startup in backend.main."""
    try:
        _ensure_wordnet_ready()
        single_meteor_score(["warm"], ["warm"])
        logger.debug("METEOR scorer pre-loaded successfully.")
    except Exception as e:
        logger.warning(f"METEOR warm-up failed (will retry on first eval): {e}")


def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated text
        reference:  Ground-truth reference text

    Returns:
        meteor: METEOR score in [0, 1]
    """
    prediction = (prediction or "").strip()
    reference = (reference or "").strip()

    if not prediction or not reference:
        return {"meteor": 0.0}

    try:
        _ensure_wordnet_ready()
        reference_tokens = _tokenize(reference)
        prediction_tokens = _tokenize(prediction)
        if not reference_tokens or not prediction_tokens:
            return {"meteor": 0.0}
        score = single_meteor_score(reference_tokens, prediction_tokens)
        return {"meteor": round(float(score), 4)}
    except Exception as e:
        logger.warning(f"METEOR computation failed: {e}")
        return {"meteor": 0.0}
