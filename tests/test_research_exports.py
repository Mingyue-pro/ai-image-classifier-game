import csv
from collections.abc import Iterator
from io import StringIO
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app.database import (
    create_database_engine,
    create_session_factory,
    get_database_session,
    initialize_database,
)
from backend.app.main import app
from backend.app.repositories.research_repository import ResearchRepository


@pytest.fixture
def export_client(tmp_path: Path) -> Iterator[tuple[TestClient, str]]:
    database_engine = create_database_engine(f"sqlite:///{tmp_path / 'exports.db'}")
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)
    with session_factory() as database_session:
        repository = ResearchRepository(database_session)
        participant = repository.create_participant(
            "P-EXPORT-01", {"ai_experience": "low"}
        )
        research_session = repository.create_session(
            participant.id,
            game_version="mvp-formative-1",
            study_phase="formative_1",
            consent_version="v1",
        )
        stage_run = repository.start_stage_run(
            research_session.id,
            case_id="stage3-trafficlight-patch",
            stage="stage3",
            attack_type="patch",
            initial_top1_label="mailbox",
        )
        repository.record_attempt(
            stage_run.id,
            tool_type="resize_patch",
            parameters_before={"size_fraction": 0.35},
            parameters_after={"size_fraction": 0.1},
            predicted_outcome="restore_correct",
            prediction_reason="=WEBSERVICE(\"https://unsafe.example\")",
            top1_before="mailbox",
            top1_after="traffic light",
            top5_after=[
                {"label": "traffic light", "probability": 0.9, "class_index": 1}
            ],
            classification_changed=True,
            correct_label_is_top1=True,
            classification_restored=True,
            output_image_path="data/runtime/private-local-path.png",
            inference_duration_ms=12.5,
        )
        repository.record_event(
            research_session.id,
            event_type="hint_opened",
            event_data={"hint_id": "patch-size"},
            stage_run_id=stage_run.id,
        )
        repository.save_response(
            research_session.id,
            question_key="stage3_reflection",
            question_version=1,
            answer_type="text",
            stage_run_id=stage_run.id,
            answer_text="A smaller Patch exposed more of the object.",
        )
        repository.save_response(
            research_session.id,
            question_key="overall_feedback",
            question_version=1,
            answer_type="text",
            answer_text="Clear feedback.",
        )

    def override_database_session() -> Iterator[Any]:
        with session_factory() as database_session:
            yield database_session

    app.dependency_overrides[get_database_session] = override_database_session
    try:
        with TestClient(app) as client:
            yield client, research_session.id
    finally:
        app.dependency_overrides.clear()
        database_engine.dispose()


def test_json_export_is_nested_complete_and_excludes_local_paths(
    export_client: tuple[TestClient, str],
) -> None:
    client, session_id = export_client

    response = client.get(f"/research/sessions/{session_id}/export.json")

    assert response.status_code == 200
    assert response.headers["content-disposition"].endswith(f'{session_id}.json"')
    payload = response.json()
    assert payload["export_version"] == 2
    assert payload["participant"]["participant_code"] == "P-EXPORT-01"
    assert payload["session"]["id"] == session_id
    assert len(payload["stage_runs"]) == 1
    stage = payload["stage_runs"][0]
    assert stage["attempts"][0]["top1_after"] == "traffic light"
    assert stage["events"][0]["event_type"] == "hint_opened"
    assert stage["responses"][0]["question_key"] == "stage3_reflection"
    assert payload["session_responses"][0]["question_key"] == "overall_feedback"
    assert "output_image_path" not in response.text
    assert "private-local-path" not in response.text


def test_csv_export_uses_long_rows_and_protects_formula_text(
    export_client: tuple[TestClient, str],
) -> None:
    client, session_id = export_client

    response = client.get(f"/research/sessions/{session_id}/export.csv")

    assert response.status_code == 200
    rows = list(csv.DictReader(StringIO(response.text)))
    assert [row["record_type"] for row in rows] == [
        "session",
        "stage",
        "attempt",
        "event",
        "response",
        "response",
    ]
    attempt = next(row for row in rows if row["record_type"] == "attempt")
    assert attempt["top1_after"] == "traffic light"
    assert attempt["parameters_after_json"] == '{"size_fraction":0.1}'
    assert attempt["prediction_reason"].startswith("'=WEBSERVICE")
    assert "output_image_path" not in response.text


def test_exports_return_not_found_for_unknown_session(
    export_client: tuple[TestClient, str],
) -> None:
    client, _ = export_client

    assert client.get("/research/sessions/missing/export.json").status_code == 404
    assert client.get("/research/sessions/missing/export.csv").status_code == 404
