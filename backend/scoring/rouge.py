"""
ROUGE scoring — wraps the rouge-score library.
Computes ROUGE-1, ROUGE-2, and ROUGE-L F1 scores.
Used for summarization tasks.
"""
import evaluate

_scorer = None

def _get_scorer():
    global _scorer
    if _scorer is None:
        _scorer = evaluate.load("rouge")
    return _scorer

def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated text
        reference:  Ground-truth reference text

    Returns:
        rouge1, rouge2, rougeL — all F1 scores in [0, 1]
    """
    if not prediction.strip() or not reference.strip():
        return {"rouge1": 0.0, "rouge2": 0.0, "rougeL": 0.0}

    scorer = _get_scorer()
    scores = scorer.compute(predictions=[prediction], references=[reference], use_stemmer=True)
    if not scores:
        return {"rouge1": 0.0, "rouge2": 0.0, "rougeL": 0.0}

    return {
        "rouge1": round(scores.get("rouge1", 0.0), 4),
        "rouge2": round(scores.get("rouge2", 0.0), 4),
        "rougeL": round(scores.get("rougeL", 0.0), 4),
    }
