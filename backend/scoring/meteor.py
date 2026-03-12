"""
METEOR scoring — via NLTK.
Better than BLEU for capturing synonymy and paraphrasing.
Used for summarization and translation tasks.
"""
import nltk
from nltk.translate.meteor_score import meteor_score


def _ensure_nltk_data():
    resources = [
        ("tokenizers/punkt_tab", "punkt_tab"),
        ("tokenizers/punkt", "punkt"),
        ("corpora/wordnet", "wordnet"),
        ("corpora/omw-1.4", "omw-1.4")
    ]
    for path, name in resources:
        try:
            nltk.data.find(path)
        except (LookupError, OSError):
            nltk.download(name, quiet=True)



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

    _ensure_nltk_data()
    ref_tokens = nltk.word_tokenize(reference.lower())
    pred_tokens = nltk.word_tokenize(prediction.lower())
    score = meteor_score([ref_tokens], pred_tokens)
    return {"meteor": round(score, 4)}
