"""
Classification metrics.
In EvalBench, items are scored individually, so these metrics return item-level scores
which are later averaged by the system to produce overall Accuracy.
"""
from backend.scoring import exact_match

def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Computes classification accuracy for a single predicted vs reference label.
    """
    # use exact match normalization to get 1.0 or 0.0
    res = exact_match.compute(prediction, reference)
    return {
        "exact_match": res["exact_match"]  # Equivalent to Accuracy
    }
