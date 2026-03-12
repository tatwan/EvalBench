"""
BLEU scoring — wraps sacrebleu for reproducible results.
Used for translation tasks. SacreBLEU handles tokenisation internally.
"""
import sacrebleu


def compute(prediction: str, reference: str) -> dict[str, float]:
    """
    Args:
        prediction: Model's generated translation
        reference:  Ground-truth reference translation

    Returns:
        bleu: corpus-level BLEU score in [0, 100]
        chrf: chrF score in [0, 100] (character n-gram — better for morphologically rich languages)
    """
    if not prediction.strip() or not reference.strip():
        return {"bleu": 0.0, "chrf": 0.0}

    bleu = sacrebleu.sentence_bleu(prediction, [reference])
    chrf = sacrebleu.sentence_chrf(prediction, [reference])
    return {
        "bleu": round(bleu.score, 2),
        "chrf": round(chrf.score, 2),
    }
