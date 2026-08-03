import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.case_catalog import CaseCatalog
from backend.app.database import (
    create_database_engine,
    create_session_factory,
    get_database_session,
    initialize_database,
)
from backend.app.database_models import InteractionEvent, Response, StageRun
from backend.app.dependencies import get_case_catalog
from backend.app.main import app


class FakeCaseCatalog:
    def __init__(self) -> None:
        self.case = {
            "case_id": "stage3-trafficlight-patch",
            "stage": "stage3",
            "attack_type": "patch",
            "initial_state_id": "initial-error",
            "states": [
                {
                    "state_id": "initial-error",
                    "top1": {"label": "mailbox"},
                }
            ],
        }

    def get_case(self, case_id: str) -> dict[str, Any]:
        if case_id != self.case["case_id"]:
            from backend.app.case_catalog import CaseNotFoundError

            raise CaseNotFoundError(f"Case does not exist: {case_id}")
        return self.case

    def get_initial_top1_label(self, case: dict[str, Any]) -> str:
        assert case is self.case
        return "mailbox"


@pytest.fixture
def research_client(tmp_path: Path) -> Iterator[TestClient]:
    database_engine = create_database_engine(
        f"sqlite:///{tmp_path / 'research-api.db'}"
    )
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)

    def override_database_session() -> Iterator[Any]:
        with session_factory() as database_session:
            yield database_session

    app.dependency_overrides[get_database_session] = override_database_session
    app.dependency_overrides[get_case_catalog] = lambda: FakeCaseCatalog()
    app.state.research_test_session_factory = session_factory
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    del app.state.research_test_session_factory
    database_engine.dispose()


def test_research_api_records_complete_session_flow(
    research_client: TestClient,
) -> None:
    participant_response = research_client.post(
        "/research/participants",
        json={
            "participant_code": "P201",
            "background": {"ai_experience": "low"},
        },
    )
    assert participant_response.status_code == 201
    participant_id = participant_response.json()["id"]

    session_response = research_client.post(
        "/research/sessions",
        json={
            "participant_id": participant_id,
            "game_version": "mvp-formative-1",
            "study_phase": "formative_1",
            "consent_version": "v1",
            "consent_confirmed": True,
        },
    )
    assert session_response.status_code == 201
    assert session_response.json()["consent_confirmed_at"] is not None
    session_id = session_response.json()["id"]

    stage_response = research_client.post(
        f"/research/sessions/{session_id}/stage-runs",
        json={"case_id": "stage3-trafficlight-patch"},
    )
    assert stage_response.status_code == 201
    assert stage_response.json()["stage"] == "stage3"
    assert stage_response.json()["attack_type"] == "patch"
    assert stage_response.json()["initial_top1_label"] == "mailbox"
    stage_run_id = stage_response.json()["id"]

    event_response = research_client.post(
        f"/research/stage-runs/{stage_run_id}/events",
        json={
            "event_type": "hint_opened",
            "event_data": {"hint_id": "patch-size"},
        },
    )
    assert event_response.status_code == 201

    answer_response = research_client.post(
        f"/research/stage-runs/{stage_run_id}/responses",
        json={
            "question_key": "stage3_reflection",
            "question_version": 1,
            "answer_type": "text",
            "answer_text": "Position and size may both affect the result.",
        },
    )
    assert answer_response.status_code == 201

    complete_stage_response = research_client.patch(
        f"/research/stage-runs/{stage_run_id}",
        json={"completion_status": "completed"},
    )
    assert complete_stage_response.status_code == 200
    assert complete_stage_response.json()["completion_status"] == "completed"
    assert complete_stage_response.json()["success"] is None
    assert complete_stage_response.json()["used_hint"] is True

    complete_session_response = research_client.patch(
        f"/research/sessions/{session_id}",
        json={"completion_status": "completed"},
    )
    assert complete_session_response.status_code == 200
    assert complete_session_response.json()["completed_at"] is not None

    session_factory = app.state.research_test_session_factory
    with session_factory() as database_session:
        assert database_session.scalar(select(StageRun)) is not None
        assert database_session.scalar(select(InteractionEvent)) is not None
        saved_response = database_session.scalar(select(Response))
        assert saved_response is not None
        assert saved_response.answer_text is not None


def test_research_api_maps_conflicts_and_missing_records(
    research_client: TestClient,
) -> None:
    payload = {"participant_code": "P202"}
    assert research_client.post("/research/participants", json=payload).status_code == 201
    duplicate = research_client.post("/research/participants", json=payload)
    assert duplicate.status_code == 409

    missing_parent = research_client.post(
        "/research/sessions",
        json={"participant_id": "missing", "game_version": "mvp"},
    )
    assert missing_parent.status_code == 404

    missing_stage = research_client.patch(
        "/research/stage-runs/missing",
        json={"completion_status": "exited"},
    )
    assert missing_stage.status_code == 404


def test_research_api_rejects_unknown_case_and_invalid_answer(
    research_client: TestClient,
) -> None:
    participant = research_client.post(
        "/research/participants", json={"participant_code": "P203"}
    ).json()
    research_session = research_client.post(
        "/research/sessions",
        json={"participant_id": participant["id"], "game_version": "mvp"},
    ).json()
    unknown_case = research_client.post(
        f"/research/sessions/{research_session['id']}/stage-runs",
        json={"case_id": "unknown-case"},
    )
    assert unknown_case.status_code == 404

    stage_run = research_client.post(
        f"/research/sessions/{research_session['id']}/stage-runs",
        json={"case_id": "stage3-trafficlight-patch"},
    ).json()
    invalid_answer = research_client.post(
        f"/research/stage-runs/{stage_run['id']}/responses",
        json={
            "question_key": "stage3_reflection",
            "question_version": 1,
            "answer_type": "text",
        },
    )
    assert invalid_answer.status_code == 422


def test_case_catalog_loads_realistic_matrix_and_rejects_duplicates(
    tmp_path: Path,
) -> None:
    matrix_path = tmp_path / "case-matrix.json"
    matrix_path.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "case_id": "stage1-banana-patch",
                        "initial_state_id": "baseline",
                        "states": [
                            {
                                "state_id": "baseline",
                                "top1": {"label": "banana"},
                            }
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    catalog = CaseCatalog(matrix_path)

    case = catalog.get_case("stage1-banana-patch")

    assert catalog.get_initial_top1_label(case) == "banana"

    duplicate_path = tmp_path / "duplicates.json"
    duplicate_path.write_text(
        json.dumps({"cases": [{"case_id": "same"}, {"case_id": "same"}]}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Duplicate case_id"):
        CaseCatalog(duplicate_path).get_case("same")
