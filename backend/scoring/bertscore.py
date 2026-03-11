from typing import List, Dict


_scorer = None


def _get_scorer():
    global _scorer
    if _scorer is None:
        from bert_score import BERTScorer
        _scorer = BERTScorer(lang="en", rescale_with_baseline=True)
    return _scorer


def compute(predictions: List[str], references: List[str]) -> Dict[str, float]:
    """
    Compute BERTScore F1 for a batch of predictions + references.
    Returns: {"bertscore_f1": float}
    """
    scorer = _get_scorer()
    P, R, F1 = scorer.score(predictions, references)
    return {"bertscore_f1": float(F1.mean().item())}


def compute_single(prediction: str, reference: str) -> Dict[str, float]:
    return compute([prediction], [reference])
