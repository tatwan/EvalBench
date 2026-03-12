"""
ROUGE scoring — wraps the rouge-score library.
Computes ROUGE-1, ROUGE-2, and ROUGE-L F1 scores.
Used for summarization tasks.
"""
from rouge_score import rouge_scorer


_SCORER = rouge_scorer.RougeScorer(
    ["rouge1", "rouge2", "rougeL"], use_stemmer=True
)


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

    scores = _SCORER.score(reference, prediction)
    return {
        "rouge1": round(scores["rouge1"].fmeasure, 4),
        "rouge2": round(scores["rouge2"].fmeasure, 4),
        "rougeL": round(scores["rougeL"].fmeasure, 4),
    }
