from backend import models as db_models
from backend.scoring.llm_judge import evaluate_with_llm


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


def test_create_eval_run_populates_typed_config_metadata(client, db):
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
