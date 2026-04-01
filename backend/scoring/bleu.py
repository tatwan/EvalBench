"""
BLEU scoring — wraps the evaluate library.
Used for translation tasks.

NOTE: evaluate natively returns scores in [0, 100]. We divide by 100 so that
bleu and chrf are in [0, 1], consistent with all other EvalBench metrics
(ROUGE, Exact Match, F1, BERTScore, etc.). This makes leaderboard rankings
and radar charts directly comparable across metric types.
"""
import evaluate

_bleu_scorer = None
_chrf_scorer = None


def _get_bleu_scorer():
    global _bleu_scorer
    if _bleu_scorer is None:
        _bleu_scorer = evaluate.load("sacrebleu")
    return _bleu_scorer


def _get_chrf_scorer():
    global _chrf_scorer
    if _chrf_scorer is None:
        _chrf_scorer = evaluate.load("chrf")
    return _chrf_scorer


def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated translation
        reference:  Ground-truth reference translation

    Returns:
        bleu: sentence BLEU score in [0, 1]
        chrf: chrF score in [0, 1]  (character n-gram F-score)
    """
    if not prediction.strip() or not reference.strip():
        return {"bleu": 0.0, "chrf": 0.0}

    bleu_scorer = _get_bleu_scorer()
    chrf_scorer = _get_chrf_scorer()

    bleu_result = bleu_scorer.compute(predictions=[prediction], references=[[reference]])
    chrf_result = chrf_scorer.compute(predictions=[prediction], references=[[reference]])

    return {
        "bleu": round(bleu_result.get("score", 0.0) / 100.0, 4),
        "chrf": round(chrf_result.get("score", 0.0) / 100.0, 4),
    }
