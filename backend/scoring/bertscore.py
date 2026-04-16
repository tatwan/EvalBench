from typing import List, Dict
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_scorer = None
_unavailable = False
_model_ready: bool = False


def _get_scorer():
    global _scorer, _unavailable
    if _unavailable:
        return None
    if _scorer is None:
        try:
            import evaluate
            _scorer = evaluate.load("bertscore")
        except Exception as e:
            logger.warning(f"Failed to load bertscore via evaluate: {e}")
            _unavailable = True
            return None
    return _scorer


def compute(predictions: List[str], references: List[str]) -> Dict[str, float]:
    """
    Compute BERTScore F1 for a batch of predictions + references.
    Returns: {"bertscore_f1": float}, or {} if bert_score is not installed.
    """
    global _model_ready
    predictions = [(prediction or "").strip() for prediction in predictions]
    references = [(reference or "").strip() for reference in references]
    if not predictions or not references or not all(predictions) or not all(references):
        return {"bertscore_f1": 0.0}

    scorer = _get_scorer()
    if scorer is None:
        return {}
    try:
        try:
            results = scorer.compute(predictions=predictions, references=references, lang="en", rescale_with_baseline=True)
        except Exception:
            # Some local environments fail when the baseline bundle is unavailable;
            # retry without baseline rescaling so the run still produces a usable score.
            try:
                results = scorer.compute(predictions=predictions, references=references, lang="en", rescale_with_baseline=False)
            except Exception:
                from bert_score import score as direct_bert_score

                _precision, _recall, f1_tensor = direct_bert_score(
                    predictions,
                    references,
                    lang="en",
                    rescale_with_baseline=False,
                    verbose=False,
                )
                f1_list = [float(v) for v in f1_tensor.tolist()]
                _model_ready = True
                return {"bertscore_f1": float(sum(f1_list) / len(f1_list)) if f1_list else 0.0}
        f1_list = results.get("f1", [])
        if not f1_list:
            return {"bertscore_f1": 0.0}
        mean_f1 = sum(f1_list) / len(f1_list)
        _model_ready = True
        return {"bertscore_f1": float(mean_f1)}
    except Exception as e:
        logger.warning(f"BERTScore computation failed: {e}")
        return {}


def compute_single(prediction: str, reference: str) -> Dict[str, float]:
    return compute([prediction], [reference])


def is_ready() -> bool:
    return readiness_state() == "ready"


def _hf_cache_roots() -> list[Path]:
    roots: list[Path] = []
    env_roots = [
        os.getenv("HUGGINGFACE_HUB_CACHE"),
        os.getenv("TRANSFORMERS_CACHE"),
        os.getenv("HF_HOME"),
    ]
    for root in env_roots:
        if root:
            roots.append(Path(root))

    xdg_cache = os.getenv("XDG_CACHE_HOME")
    if xdg_cache:
        roots.extend([
            Path(xdg_cache) / "huggingface",
            Path(xdg_cache) / "huggingface" / "hub",
        ])

    home_cache = Path.home() / ".cache"
    roots.extend([
        home_cache / "huggingface",
        home_cache / "huggingface" / "hub",
        home_cache / "torch" / "transformers",
    ])

    # Preserve order while dropping duplicates.
    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            unique.append(root)
            seen.add(key)
    return unique


def _has_cached_model() -> bool:
    cache_markers = (
        "models--roberta-large",
        "roberta-large",
    )
    for root in _hf_cache_roots():
        for marker in cache_markers:
            if (root / marker).exists() or (root / "hub" / marker).exists():
                return True
    return False


def readiness_state() -> str:
    if not is_available():
        return "unavailable"
    if _model_ready or _has_cached_model():
        return "ready"
    return "download_required"


def is_available() -> bool:
    try:
        import evaluate
        import bert_score  # noqa: F401
        return True
    except ImportError:
        return False
