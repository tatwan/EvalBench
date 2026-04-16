"""
ROUGE scoring — uses the direct rouge-score package.
This avoids the fragile evaluate module cache path that can fail under
concurrent local runs.
"""
import threading
from rouge_score import rouge_scorer

_scorer = None
_scorer_lock = threading.Lock()


def _get_scorer():
    global _scorer
    if _scorer is None:
        with _scorer_lock:
            if _scorer is None:
                _scorer = rouge_scorer.RougeScorer(
                    ["rouge1", "rouge2", "rougeL", "rougeLsum"],
                    use_stemmer=True,
                )
    return _scorer

def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated text
        reference:  Ground-truth reference text

    Returns:
        rouge1, rouge2, rougeL, rougeLsum — all F1 scores in [0, 1]
    """
    if not prediction.strip() or not reference.strip():
        return {"rouge1": 0.0, "rouge2": 0.0, "rougeL": 0.0, "rougeLsum": 0.0}

    scorer = _get_scorer()
    scores = scorer.score(reference, prediction)
    if not scores:
        return {"rouge1": 0.0, "rouge2": 0.0, "rougeL": 0.0, "rougeLsum": 0.0}

    return {
        "rouge1": round(float(scores["rouge1"].fmeasure), 4),
        "rouge2": round(float(scores["rouge2"].fmeasure), 4),
        "rougeL": round(float(scores["rougeL"].fmeasure), 4),
        "rougeLsum": round(float(scores["rougeLsum"].fmeasure), 4),
    }
