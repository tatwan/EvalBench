"""
Distinct-n — measures lexical diversity of generated text.
Ratio of unique n-grams to total n-grams.
Higher = more diverse and less repetitive output.
No external dependencies.
"""


def _ngrams(tokens: list[str], n: int) -> list[tuple]:
    return [tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def compute(prediction: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated text (no reference needed)

    Returns:
        distinct1: ratio of unique unigrams in [0, 1]
        distinct2: ratio of unique bigrams in [0, 1]
    """
    tokens = prediction.lower().split()
    if not tokens:
        return {"distinct1": 0.0, "distinct2": 0.0}

    unigrams = tokens
    bigrams = _ngrams(tokens, 2)

    d1 = len(set(unigrams)) / len(unigrams) if unigrams else 0.0
    d2 = len(set(bigrams)) / len(bigrams) if bigrams else 0.0

    return {
        "distinct1": round(d1, 4),
        "distinct2": round(d2, 4),
    }
