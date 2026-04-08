from typing import List, Dict
import logging

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
    scorer = _get_scorer()
    if scorer is None:
        return {}
    try:
        results = scorer.compute(predictions=predictions, references=references, lang="en", rescale_with_baseline=True)
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
    return _model_ready


def is_available() -> bool:
    try:
        import evaluate
        import bert_score  # noqa: F401
        return True
    except ImportError:
        return False
