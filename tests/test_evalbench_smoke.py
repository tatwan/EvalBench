from backend import models as db_models
from backend.scoring import exact_match, rouge, meteor, rag, speed, bertscore
from backend.scoring.llm_judge import evaluate_with_llm
from backend.services import dataset_seeder
from backend.services import storage


def test_eval_run_create_requires_model_ids(client):
    response = client.post(
        "/api/eval-runs",
        json={
            "modelIds": [],
            "taskType": "qa",
        },
    )

    # 400 when neither local nor cloud models are provided
    assert response.status_code == 400


def test_eval_stats_excludes_error_rows(client, db):
    model = db_models.Model(name="llama-test")
    run = db_models.EvalRun(status="completed", config_json={"taskType": "qa"})
    db.add_all([model, run])
    db.commit()
    db.refresh(model)
    db.refresh(run)

    db.add_all(
        [
            db_models.EvalResult(
                run_id=run.id,
                model_id=model.id,
                metric_name="exact_match",
                score=1.0,
                error=False,
            ),
            db_models.EvalResult(
                run_id=run.id,
                model_id=model.id,
                metric_name="exact_match",
                score=0.0,
                error=True,
            ),
        ]
    )
    db.commit()

    response = client.get(f"/api/eval-runs/{run.id}/stats")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["modelId"] == model.id
    assert payload[0]["metricName"] == "exact_match"
    assert payload[0]["mean"] == 1.0
    assert payload[0]["count"] == 1


def test_evaluate_with_llm_without_judge_config_returns_helpful_message(db):
    score, rationale = evaluate_with_llm(
        db,
        metric_name="llm_relevance",
        input_text="What is EvalBench?",
        output_text="A local-first evaluation workbench.",
    )

    assert score == 0.0
    assert "not configured" in rationale.lower()


def test_cancel_eval_run_marks_run_for_cancellation(client, db):
    run = db_models.EvalRun(status="running", config_json={"taskType": "qa"})
    db.add(run)
    db.commit()
    db.refresh(run)

    response = client.post(f"/api/eval-runs/{run.id}/cancel")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "cancel_requested"
    assert payload["configJson"]["cancelRequested"] is True


def test_create_dataset_increments_schema_version(client):
    payload = {
        "name": "Acme QA Set",
        "source": "manual",
        "items": [
            {
                "input": "What is EvalBench?",
                "expectedOutput": "A local-first evaluation workbench.",
                "difficulty": "easy",
            }
        ],
    }

    first = client.post("/api/datasets", json=payload)
    second = client.post("/api/datasets", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["schemaVersion"] == 1
    assert second.json()["schemaVersion"] == 2
    assert second.json()["itemCount"] == 1


def test_create_dataset_from_built_in_source_becomes_manual_derived(client):
    response = client.post(
        "/api/datasets",
        json={
            "name": "Derived From Built-in",
            "source": "curated-inline",
            "items": [
                {
                    "input": "Question",
                    "expectedOutput": "Answer",
                }
            ],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["source"] == "manual:derived"


def test_legacy_derived_builtin_name_is_normalized_in_dataset_list_and_detail(client, db):
    dataset = db_models.GoldenDataset(
        name="EvalBench MMLU (Subset)",
        source="curated-inline",
        schema_version=2,
    )
    db.add(dataset)
    db.flush()
    db.add(
        db_models.GoldenItem(
            dataset_id=dataset.id,
            input="Question",
            expected_output="Answer",
        )
    )
    db.commit()
    db.refresh(dataset)

    listing = client.get("/api/datasets")
    detail = client.get(f"/api/datasets/{dataset.id}")

    assert listing.status_code == 200
    listed = next(row for row in listing.json() if row["id"] == dataset.id)
    assert listed["source"] == "manual:derived"

    assert detail.status_code == 200
    assert detail.json()["source"] == "manual:derived"


def test_legacy_custom_named_dataset_with_curated_inline_source_is_deletable(client, db):
    dataset = db_models.GoldenDataset(
        name="EvalBench MMLU (Subset) Tarek Atwan",
        source="curated-inline",
        schema_version=1,
    )
    db.add(dataset)
    db.flush()
    db.add(
        db_models.GoldenItem(
            dataset_id=dataset.id,
            input="Question",
            expected_output="Answer",
        )
    )
    db.commit()
    db.refresh(dataset)

    response = client.delete(f"/api/datasets/{dataset.id}")

    assert response.status_code == 200
    assert db.query(db_models.GoldenDataset).filter_by(id=dataset.id).first() is None


def test_seeded_builtin_dataset_stays_protected_from_delete(client, db):
    dataset = db_models.GoldenDataset(
        name="EvalBench MMLU (Subset)",
        source="curated-inline",
        schema_version=1,
    )
    db.add(dataset)
    db.flush()
    db.add(
        db_models.GoldenItem(
            dataset_id=dataset.id,
            input="Question",
            expected_output="Answer",
        )
    )
    db.commit()
    db.refresh(dataset)

    response = client.delete(f"/api/datasets/{dataset.id}")

    assert response.status_code == 400
    assert "built-in datasets cannot be deleted" in response.json()["detail"].lower()


def test_preview_and_import_csv_dataset(client):
    csv_content = "\n".join(
        [
            "input,expected_output,difficulty,tags",
            '"Why do retries matter?","Retries make transient infra failures less disruptive.","medium","reliability,infra"',
            '"What is a golden dataset?","A curated set of inputs and expected outputs for evaluation.","easy","datasets,qa"',
        ]
    )

    preview = client.post(
        "/api/datasets/import-preview",
        json={
            "name": "Reliability Notes",
            "source": "spreadsheet",
            "format": "csv",
            "content": csv_content,
        },
    )
    created = client.post(
        "/api/datasets/import",
        json={
            "name": "Reliability Notes",
            "source": "spreadsheet",
            "format": "csv",
            "content": csv_content,
        },
    )

    assert preview.status_code == 200
    preview_payload = preview.json()
    assert preview_payload["count"] == 2
    assert preview_payload["items"][0]["input"] == "Why do retries matter?"

    assert created.status_code == 201
    created_payload = created.json()
    assert created_payload["itemCount"] == 2
    assert created_payload["items"][0]["difficulty"] == "medium"
    assert created_payload["items"][0]["tags"] == ["reliability", "infra"]


def test_delete_custom_dataset_when_unused(client, db):
    dataset = db_models.GoldenDataset(name="Scratch Pad", source="manual", schema_version=1)
    db.add(dataset)
    db.flush()
    db.add(
        db_models.GoldenItem(
            dataset_id=dataset.id,
            input="Question",
            expected_output="Answer",
        )
    )
    db.commit()
    db.refresh(dataset)

    response = client.delete(f"/api/datasets/{dataset.id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == dataset.id
    assert db.query(db_models.GoldenDataset).filter_by(id=dataset.id).first() is None


def test_delete_dataset_blocked_when_eval_history_exists(client, db):
    dataset = db_models.GoldenDataset(name="Used Dataset", source="manual", schema_version=1)
    model = db_models.Model(name="history-model")
    run = db_models.EvalRun(status="completed", config_json={"taskType": "qa", "datasetId": 1})
    db.add_all([dataset, model, run])
    db.flush()
    item = db_models.GoldenItem(
        dataset_id=dataset.id,
        input="Question",
        expected_output="Answer",
    )
    db.add(item)
    db.flush()
    db.add(
        db_models.EvalResult(
            run_id=run.id,
            model_id=model.id,
            metric_name="exact_match",
            score=1.0,
            item_id=item.id,
        )
    )
    db.commit()

    response = client.delete(f"/api/datasets/{dataset.id}")

    assert response.status_code == 400
    assert "cannot be deleted" in response.json()["detail"].lower()


def test_preview_dataset_reports_row_level_csv_error(client):
    bad_csv = "\n".join(
        [
            "input,expected_output,difficulty",
            '"Healthy row","Expected output","easy"',
            '"Broken row","","medium"',
        ]
    )

    response = client.post(
        "/api/datasets/import-preview",
        json={
            "name": "Broken CSV",
            "source": "spreadsheet",
            "format": "csv",
            "content": bad_csv,
        },
    )

    assert response.status_code == 400
    assert "CSV row 3" in response.json()["detail"]


def test_settings_connection_test_requires_judge_model(client):
    response = client.post(
        "/api/settings/test-connection",
        json={"target": "judge"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert "judge model" in payload["message"].lower()


def test_wipe_data_removes_cloud_models_but_keeps_local_models(client, db):
    local_model = db_models.Model(name="llama-local", family="llama")
    cloud_model = db_models.Model(name="gpt-5.4-mini", family="cloud")
    db.add_all([local_model, cloud_model])
    db.commit()

    response = client.post("/api/settings/wipe-data")

    assert response.status_code == 200
    remaining_models = db.query(db_models.Model).order_by(db_models.Model.name.asc()).all()
    assert "llama-local" in [model.name for model in remaining_models]
    assert all(model.family != "cloud" for model in remaining_models)


def test_settings_connection_test_validates_openai_key_format(client):
    response = client.post(
        "/api/settings/test-connection",
        json={"target": "openai", "openaiApiKey": "not-a-real-key"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert "format looks unusual" in payload["message"].lower()


def test_settings_connection_test_accepts_unsaved_openai_override(client):
    response = client.post(
        "/api/settings/test-connection",
        json={"target": "openai", "openaiApiKey": "sk-test-1234567890"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert "look ready" in payload["message"].lower()

    settings = client.get("/api/settings")
    assert settings.status_code == 200
    assert settings.json() == []


def test_seed_built_in_datasets_includes_expanded_gsm8k(db):
    dataset_seeder.seed_if_empty(db)

    dataset = db.query(db_models.GoldenDataset).filter_by(name="EvalBench GSM8K (Expanded v2)").first()

    assert dataset is not None
    assert dataset.schema_version == 2
    item_count = db.query(db_models.GoldenItem).filter_by(dataset_id=dataset.id).count()
    assert item_count == len(dataset_seeder.GSM8K_EXPANDED_ITEMS)
    assert item_count >= 20


def test_seed_built_in_datasets_includes_winogrande_subset(db):
    dataset_seeder.seed_if_empty(db)

    dataset = db.query(db_models.GoldenDataset).filter_by(name="EvalBench WinoGrande (Subset)").first()

    assert dataset is not None
    assert dataset.schema_version == 1
    item_count = db.query(db_models.GoldenItem).filter_by(dataset_id=dataset.id).count()
    assert item_count == len(dataset_seeder.WINOGRANDE_ITEMS)
    assert item_count >= 20


def test_seed_built_in_datasets_includes_expanded_humaneval(db):
    dataset_seeder.seed_if_empty(db)

    dataset = db.query(db_models.GoldenDataset).filter_by(name="EvalBench HumanEval (Expanded v2)").first()

    assert dataset is not None
    assert dataset.schema_version == 2
    item_count = db.query(db_models.GoldenItem).filter_by(dataset_id=dataset.id).count()
    assert item_count == len(dataset_seeder.HUMANEVAL_EXPANDED_ITEMS)
    assert item_count >= 10


def test_create_eval_run_populates_typed_config_metadata(client, db):
    db.add(db_models.Setting(key="judge_model", value="gpt-4o-mini"))
    db.commit()

    dataset = db_models.GoldenDataset(name="Typed Config Dataset", schema_version=1)
    db.add(dataset)
    db.flush()
    db.add(
        db_models.GoldenItem(
            dataset_id=dataset.id,
            input="What is EvalBench?",
            expected_output="A local-first evaluation workbench.",
        )
    )
    model = db_models.Model(name="llama-typed")
    db.add(model)
    db.commit()
    db.refresh(dataset)
    db.refresh(model)

    response = client.post(
        "/api/eval-runs",
        json={
            "modelIds": [model.id],
            "taskType": "qa",
            "datasetId": dataset.id,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["configJson"]["taskType"] == "qa"
    assert payload["configJson"]["modelIds"] == [model.id]
    assert payload["configJson"]["datasetId"] == dataset.id
    assert payload["configJson"]["datasetItemCount"] == 1
    assert payload["configJson"]["benchmarkKeys"] == ["qa"]
    assert payload["configJson"]["judgeModel"] == "gpt-4o-mini"
    assert payload["configJson"]["judgeProvider"] == "openai"


def test_get_random_model_pair_uses_only_non_embedding_models(db):
    models = [
        db_models.Model(name="nomic-embed-text"),
        db_models.Model(name="llama3.2"),
        db_models.Model(name="mistral-small"),
    ]
    db.add_all(models)
    db.commit()

    pair = storage.get_random_model_pair(db)

    assert pair is not None
    assert pair[0].id != pair[1].id
    assert "embed" not in pair[0].name
    assert "embed" not in pair[1].name


def test_get_model_pair_by_ids_rejects_embedding_models(db):
    embed_model = db_models.Model(name="nomic-embed-text-test")
    text_model = db_models.Model(name="llama3.2-test")
    db.add_all([embed_model, text_model])
    db.commit()

    assert storage.get_model_pair_by_ids(db, embed_model.id, text_model.id) is None


def test_arena_leaderboard_hides_zero_game_seed_ratings(db):
    fresh_model = db_models.Model(name="fresh-arena-model")
    seeded_elo = db_models.EloRating(model_id=1, rating=1200, games_played=0)
    db.add(fresh_model)
    db.flush()
    seeded_elo.model_id = fresh_model.id
    db.add(seeded_elo)
    db.commit()

    leaderboard = storage.get_arena_leaderboard(db)

    assert leaderboard == []


def test_rouge_compute_includes_rouge_lsum(monkeypatch):
    class FakeScorer:
        class Score:
            def __init__(self, value):
                self.fmeasure = value

        def score(self, reference, prediction):
            return {
                "rouge1": self.Score(0.5),
                "rouge2": self.Score(0.25),
                "rougeL": self.Score(0.4),
                "rougeLsum": self.Score(0.45),
            }

    monkeypatch.setattr(rouge, "_scorer", None)
    monkeypatch.setattr(rouge, "_get_scorer", lambda: FakeScorer())

    scores = rouge.compute("alpha", "beta")

    assert scores["rougeLsum"] == 0.45


def test_exact_match_normalizes_multiple_choice_predictions():
    assert exact_match.compute("C) Radiation", "C") == {"exact_match": 1.0, "f1": 1.0}
    assert exact_match.compute("The answer is B because of routing", "B") == {"exact_match": 1.0, "f1": 1.0}
    assert exact_match.compute("A", "C") == {"exact_match": 0.0, "f1": 0.0}


def test_wipe_data_resets_visible_ids(client, db):
    model_a = db_models.Model(name="arena-a")
    model_b = db_models.Model(name="arena-b")
    run = db_models.EvalRun(status="completed", config_json={"taskType": "qa"})
    db.add_all([model_a, model_b, run])
    db.commit()
    db.refresh(model_a)
    db.refresh(model_b)
    db.refresh(run)

    db.add(
        db_models.EvalResult(
            run_id=run.id,
            model_id=model_a.id,
            metric_name="exact_match",
            score=1.0,
            error=False,
        )
    )
    db.add(
        db_models.ArenaBattle(
            model_a_id=model_a.id,
            model_b_id=model_b.id,
            prompt="test prompt",
            winner="model_a",
        )
    )
    db.commit()

    response = client.post("/api/settings/wipe-data")
    assert response.status_code == 200

    new_run = db_models.EvalRun(status="pending", config_json={"taskType": "qa"})
    db.add(new_run)
    db.commit()
    db.refresh(new_run)

    assert new_run.id == 1


def test_meteor_compute_uses_flat_reference_list(monkeypatch):
    assert meteor.compute("alpha beta", "alpha beta")["meteor"] > 0.9


def test_compute_api_usage_maps_openai_like_usage():
    class Usage:
        prompt_tokens = 42
        completion_tokens = 21

    class Response:
        usage = Usage()

    metrics = speed.compute_api_usage(Response(), 2.1)

    assert metrics == {
        "total_latency_s": 2.1,
        "prompt_tokens": 42,
        "output_tokens": 21,
        "tokens_per_second": 10.0,
    }


def test_bertscore_retries_without_baseline(monkeypatch):
    calls: list[bool] = []

    class FakeScorer:
        def compute(self, **kwargs):
            calls.append(kwargs["rescale_with_baseline"])
            if kwargs["rescale_with_baseline"]:
                raise TypeError("'NoneType' object is not iterable")
            return {"f1": [0.75]}

    monkeypatch.setattr(bertscore, "_scorer", None)
    monkeypatch.setattr(bertscore, "_get_scorer", lambda: FakeScorer())

    assert bertscore.compute(["alpha"], ["beta"]) == {"bertscore_f1": 0.75}
    assert calls == [True, False]


def test_save_eval_result_persists_error_rows(db):
    model = db_models.Model(name="cloud-speed-test")
    run = db_models.EvalRun(status="failed", config_json={"taskType": "summarization"})
    db.add_all([model, run])
    db.commit()
    db.refresh(model)
    db.refresh(run)

    result = storage.save_eval_result(
        db,
        run_id=run.id,
        model_id=model.id,
        metric_name="bertscore_f1",
        score=0.0,
        raw_output="Cloud failure",
        error=True,
    )

    assert result.error is True
    assert result.raw_output == "Cloud failure"


def test_evaluate_with_llm_retries_with_max_completion_tokens(db):
    existing = db.query(db_models.Setting).filter_by(key="judge_model").first()
    if existing:
        existing.value = "gpt-5-mini"
    else:
        db.add(db_models.Setting(key="judge_model", value="gpt-5-mini"))
    db.commit()

    calls: list[dict] = []

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            if "max_tokens" in kwargs:
                raise Exception("unsupported_parameter: use max_completion_tokens instead")

            class Message:
                content = "Justification: looks good\nScore: 5"

            class Choice:
                message = Message()

            class Response:
                choices = [Choice()]

            return Response()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    import backend.scoring.llm_judge as llm_judge
    original_get_judge_client = llm_judge.get_judge_client
    llm_judge.get_judge_client = lambda _db: (FakeClient(), "gpt-5-mini", None, None)
    try:
        score, rationale = evaluate_with_llm(db, "llm_relevance", "prompt", "output")
    finally:
        llm_judge.get_judge_client = original_get_judge_client

    assert score == 1.0
    assert "Score: 5" in rationale
    assert "max_tokens" in calls[0]
    assert "max_completion_tokens" in calls[1]


def test_rag_openai_judge_retries_with_max_completion_tokens():
    calls: list[dict] = []

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            if "max_tokens" in kwargs:
                raise Exception("unsupported_parameter: use max_completion_tokens instead")

            class Message:
                content = "4"

            class Choice:
                message = Message()

            class Response:
                choices = [Choice()]

            return Response()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    score = rag.compute_rag_metrics(
        question="What is EvalBench?",
        context="EvalBench is a local-first evaluation tool.",
        answer="EvalBench is a local-first evaluation tool.",
        client=FakeClient(),
        anthropic_client=None,
        model="gpt-5-mini",
    )

    assert score["context_relevance"] == 0.75
    assert score["faithfulness"] == 0.75
    assert "max_tokens" in calls[0]
    assert "max_completion_tokens" in calls[1]


def test_rag_metrics_include_rationale():
    class FakeCompletions:
        def create(self, **kwargs):
            class Message:
                content = "Justification: grounded in the retrieved facts\nScore: 4"

            class Choice:
                message = Message()

            class Response:
                choices = [Choice()]

            return Response()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    score = rag.compute_rag_metrics_with_rationale(
        question="What is EvalBench?",
        context="EvalBench is a local-first evaluation tool.",
        answer="EvalBench is a local-first evaluation tool.",
        client=FakeClient(),
        anthropic_client=None,
        model="gpt-5-mini",
    )

    assert score["context_relevance"]["score"] == 0.75
    assert "Justification:" in str(score["context_relevance"]["rationale"])
    assert score["faithfulness"]["score"] == 0.75
