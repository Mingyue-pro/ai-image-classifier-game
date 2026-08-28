from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.database import (
    SQLITE_BUSY_TIMEOUT_MILLISECONDS,
    create_database_engine,
    create_session_factory,
    engine,
    initialize_database,
)
from backend.app.database_models import (
    Attempt,
    InteractionEvent,
    Participant,
    ResearchSession,
    Response,
    StageRun,
)
from backend.app.main import app


@pytest.fixture
def database_session(tmp_path: Path) -> Session:
    database_path = tmp_path / "nested" / "research-test.db"
    database_engine = create_database_engine(f"sqlite:///{database_path}")
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)

    with session_factory() as session:
        yield session

    database_engine.dispose()


def test_initialize_database_creates_six_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "research" / "game.db"
    database_engine = create_database_engine(f"sqlite:///{database_path}")

    initialize_database(database_engine)

    assert database_path.is_file()
    assert set(inspect(database_engine).get_table_names()) == {
        "attempts",
        "interaction_events",
        "participants",
        "responses",
        "sessions",
        "stage_runs",
    }
    database_engine.dispose()


def test_file_backed_sqlite_uses_concurrent_request_pragmas(tmp_path: Path) -> None:
    database_path = tmp_path / "research" / "concurrent.db"
    database_engine = create_database_engine(f"sqlite:///{database_path}")
    initialize_database(database_engine)

    with database_engine.connect() as connection:
        busy_timeout = connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
        journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar_one()
        foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one()

    assert busy_timeout == SQLITE_BUSY_TIMEOUT_MILLISECONDS
    assert journal_mode == "wal"
    assert foreign_keys == 1
    database_engine.dispose()


def test_fastapi_lifespan_initializes_configured_database() -> None:
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200

    assert set(inspect(engine).get_table_names()) == {
        "attempts",
        "interaction_events",
        "participants",
        "responses",
        "sessions",
        "stage_runs",
    }


def test_database_persists_complete_anonymous_stage_flow(
    database_session: Session,
) -> None:
    participant = Participant(
        participant_code="P007",
        background={"ai_experience": "occasional"},
    )
    research_session = ResearchSession(
        participant=participant,
        game_version="mvp-formative-1",
        study_phase="formative_1",
        consent_version="v1",
    )
    stage_run = StageRun(
        session=research_session,
        case_id="stage3-trafficlight-patch",
        stage="stage3",
        attack_type="patch",
        initial_top1_label="mailbox",
    )
    attempt = Attempt(
        stage_run=stage_run,
        attempt_number=1,
        tool_type="resize_patch",
        parameters_before={
            "position_x": 0.4,
            "position_y": 0.5,
            "size_fraction": 0.35,
        },
        parameters_after={
            "position_x": 0.4,
            "position_y": 0.5,
            "size_fraction": 0.1,
        },
        predicted_outcome="restore_correct",
        prediction_reason="The patch covers less of the object.",
        top1_before="mailbox",
        top1_after="traffic light",
        top5_after=[
            {"label": "traffic light", "probability": 0.8, "class_index": 920}
        ],
        classification_changed=True,
        correct_label_is_top1=True,
        classification_restored=True,
        output_image_path="data/runtime/session/attempt-1.png",
        inference_duration_ms=420.0,
    )
    interaction_event = InteractionEvent(
        session=research_session,
        stage_run=stage_run,
        event_type="hint_opened",
        event_data={"hint_id": "patch-size"},
    )
    response = Response(
        session=research_session,
        stage_run=stage_run,
        question_key="future_transfer_question_not_yet_finalised",
        question_version=1,
        answer_type="text",
        answer_text="I compared the result before and after changing the patch.",
    )
    database_session.add_all(
        [participant, research_session, stage_run, attempt, interaction_event, response]
    )
    database_session.commit()

    saved_attempt = database_session.scalar(select(Attempt))
    saved_response = database_session.scalar(select(Response))
    saved_event = database_session.scalar(select(InteractionEvent))

    assert saved_attempt is not None
    assert saved_attempt.tool_type == "resize_patch"
    assert saved_attempt.parameters_after["size_fraction"] == 0.1
    assert saved_attempt.classification_restored is True
    assert saved_response is not None
    assert saved_response.question_key == "future_transfer_question_not_yet_finalised"
    assert saved_response.answer_text is not None
    assert saved_event is not None
    assert saved_event.event_data == {"hint_id": "patch-size"}


def test_database_enforces_foreign_keys(database_session: Session) -> None:
    database_session.add(
        StageRun(
            session_id="missing-session",
            case_id="stage1-banana-patch",
            stage="stage1",
            attack_type="patch",
        )
    )

    with pytest.raises(IntegrityError):
        database_session.commit()

    database_session.rollback()


def test_database_rejects_duplicate_attempt_number(
    database_session: Session,
) -> None:
    participant = Participant(participant_code="P008")
    research_session = ResearchSession(
        participant=participant,
        game_version="mvp-formative-1",
    )
    stage_run = StageRun(
        session=research_session,
        case_id="stage3-trafficlight-pixel",
        stage="stage3",
        attack_type="fgsm",
    )
    shared_values = {
        "stage_run": stage_run,
        "attempt_number": 1,
        "tool_type": "change_epsilon",
        "parameters_after": {"epsilon_pixels": 1},
        "top1_after": "traffic light",
        "classification_changed": True,
        "correct_label_is_top1": True,
        "classification_restored": True,
    }
    database_session.add_all([Attempt(**shared_values), Attempt(**shared_values)])

    with pytest.raises(IntegrityError):
        database_session.commit()

    database_session.rollback()
