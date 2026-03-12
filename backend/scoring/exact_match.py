"""
Exact Match and Token F1 — standard QA evaluation metrics.
Same normalization as the SQuAD official evaluation script.
No external dependencies.
"""
import re
import string
from collections import Counter


def _normalize(text: str) -> str:
    """Lowercase, strip articles and punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r"\b(a|an|the)\b", " ", text)
    text = text.translate(str.maketrans("", "", string.punctuation))
    return " ".join(text.split())


def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's extracted answer
        reference:  Ground-truth answer string

    Returns:
        exact_match: 1.0 if normalized strings match exactly, else 0.0
        f1:          Token-level F1 score in [0, 1]
    """
    pred_norm = _normalize(prediction)
    ref_norm = _normalize(reference)

    exact = 1.0 if pred_norm == ref_norm else 0.0

    pred_tokens = Counter(pred_norm.split())
    ref_tokens = Counter(ref_norm.split())
    common = sum((pred_tokens & ref_tokens).values())

    if common == 0:
        return {"exact_match": exact, "f1": 0.0}

    precision = common / sum(pred_tokens.values())
    recall = common / sum(ref_tokens.values())
    f1 = 2 * precision * recall / (precision + recall)
    return {
        "exact_match": exact,
        "f1": round(f1, 4),
    }
