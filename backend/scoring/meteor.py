"""
METEOR scoring — via the evaluate library.
Better than BLEU for capturing synonymy and paraphrasing.
Used for summarization and translation tasks.
"""
import evaluate

_scorer = None


def _get_scorer():
    global _scorer
    if _scorer is None:
        _scorer = evaluate.load("meteor")
    return _scorer


def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated text
        reference:  Ground-truth reference text

    Returns:
        meteor: METEOR score in [0, 1]
    """
    if not prediction.strip() or not reference.strip():
        return {"meteor": 0.0}

    scorer = _get_scorer()
    result = scorer.compute(predictions=[prediction], references=[[reference]])

    return {"meteor": round(result.get("meteor", 0.0), 4)}
