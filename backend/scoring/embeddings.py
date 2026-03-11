import math
from typing import List, Tuple


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def rank_by_similarity(query_vec: List[float], candidate_vecs: List[List[float]]) -> Tuple[List[int], List[float]]:
    sims = [cosine_similarity(query_vec, cand) for cand in candidate_vecs]
    ranked = sorted(range(len(sims)), key=lambda i: sims[i], reverse=True)
    return ranked, sims


def compute_embedding_metrics(query_vec: List[float], candidate_vecs: List[List[float]], answer_index: int) -> dict[str, float]:
    if answer_index < 0 or answer_index >= len(candidate_vecs):
        return {"cosine_sim": 0.0, "recall_at_1": 0.0, "recall_at_3": 0.0, "mrr": 0.0}

    ranked, sims = rank_by_similarity(query_vec, candidate_vecs)
    rank = ranked.index(answer_index) + 1

    return {
        "cosine_sim": sims[answer_index],
        "recall_at_1": 1.0 if rank == 1 else 0.0,
        "recall_at_3": 1.0 if rank <= 3 else 0.0,
        "mrr": 1.0 / rank,
    }
