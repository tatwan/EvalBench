from typing import List, Dict
import logging

logger = logging.getLogger(__name__)

_scorer = None
_unavailable = False


def _get_scorer():
    global _scorer, _unavailable
    if _unavailable:
        return None
    if _scorer is None:
        try:
            from bert_score import BERTScorer
            _scorer = BERTScorer(lang="en", rescale_with_baseline=True)
        except ImportError:
            logger.warning("bert_score not installed — bertscore_f1 will be skipped. Run `uv sync` to enable it.")
            _unavailable = True
            return None
    return _scorer


def compute(predictions: List[str], references: List[str]) -> Dict[str, float]:
    """
    Compute BERTScore F1 for a batch of predictions + references.
    Returns: {"bertscore_f1": float}, or {} if bert_score is not installed.
    """
    scorer = _get_scorer()
    if scorer is None:
        return {}
    P, R, F1 = scorer.score(predictions, references)
    return {"bertscore_f1": float(F1.mean().item())}


def compute_single(prediction: str, reference: str) -> Dict[str, float]:
    return compute([prediction], [reference])


def is_available() -> bool:
    try:
        import bert_score  # noqa: F401
        return True
    except ImportError:
        return False
