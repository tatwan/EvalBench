from backend.scoring import embeddings


def test_compute_embedding_metrics_returns_ndcg_for_top_rank():
    query = [1.0, 0.0]
    candidates = [
        [1.0, 0.0],
        [0.3, 0.7],
        [0.0, 1.0],
    ]

    metrics = embeddings.compute_embedding_metrics(query, candidates, answer_index=0)

    assert metrics["cosine_sim"] == 1.0
    assert metrics["recall_at_1"] == 1.0
    assert metrics["recall_at_3"] == 1.0
    assert metrics["mrr"] == 1.0
    assert metrics["ndcg"] == 1.0


def test_compute_embedding_metrics_returns_discounted_ndcg_for_lower_rank():
    query = [1.0, 0.0]
    candidates = [
        [1.0, 0.0],
        [0.95, 0.05],
        [0.8, 0.2],
    ]

    metrics = embeddings.compute_embedding_metrics(query, candidates, answer_index=2)

    assert metrics["recall_at_1"] == 0.0
    assert metrics["recall_at_3"] == 1.0
    assert round(metrics["mrr"], 4) == round(1 / 3, 4)
    assert round(metrics["ndcg"], 4) == round(1 / 2, 4)


def test_compute_embedding_metrics_returns_zeroes_for_invalid_answer_index():
    metrics = embeddings.compute_embedding_metrics([1.0], [[1.0], [0.5]], answer_index=5)

    assert metrics == {
        "cosine_sim": 0.0,
        "recall_at_1": 0.0,
        "recall_at_3": 0.0,
        "mrr": 0.0,
        "ndcg": 0.0,
    }
