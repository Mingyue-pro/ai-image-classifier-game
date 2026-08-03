from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.database import (
    create_database_engine,
    create_session_factory,
    initialize_database,
)
from backend.app.database_models import Attempt, InteractionEvent, Response, StageRun
from backend.app.repositories.research_repository import (
    DatabaseConflictError,
    RecordNotFoundError,
    ResearchRepository,
)


@pytest.fixture
def repository(tmp_path: Path) -> ResearchRepository:
    database_engine = create_database_engine(f"sqlite:///{tmp_path / 'repository.db'}")
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)

    with session_factory() as database_session:
        yield ResearchRepository(database_session)

    database_engine.dispose()


def test_repository_records_complete_stage_and_session_flow(
    repository: ResearchRepository,
) -> None:
    participant = repository.create_participant(
        "P101",
        background={"ai_experience": "low"},
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

    first_attempt = repository.record_attempt(
        stage_run.id,
        tool_type="move_patch",
        parameters_before={"position_x": 0.4, "size_fraction": 0.35},
        parameters_after={"position_x": 0.5, "size_fraction": 0.35},
        predicted_outcome="remain_wrong",
        top1_before="mailbox",
        top1_after="mailbox",
        classification_changed=False,
        correct_label_is_top1=False,
        classification_restored=False,
    )
    second_attempt = repository.record_attempt(
        stage_run.id,
        tool_type="resize_patch",
        parameters_before={"position_x": 0.5, "size_fraction": 0.35},
        parameters_after={"position_x": 0.5, "size_fraction": 0.1},
        predicted_outcome="restore_correct",
        prediction_reason="The patch will cover less of the traffic light.",
        top1_before="mailbox",
        top1_after="traffic light",
        classification_changed=True,
        correct_label_is_top1=True,
        classification_restored=True,
    )
    event = repository.record_event(
        research_session.id,
        event_type="hint_opened",
        event_data={"hint_id": "patch-size"},
        stage_run_id=stage_run.id,
    )
    response = repository.save_response(
        research_session.id,
        question_key="stage3_reflection",
        question_version=1,
        answer_type="text",
        stage_run_id=stage_run.id,
        answer_text="Position and size can both affect the classifier result.",
    )
    completed_stage = repository.complete_stage_run(
        stage_run.id,
        success=True,
        final_top1_label="traffic light",
        classification_restored=True,
        used_hint=True,
    )
    completed_session = repository.complete_session(research_session.id)

    assert first_attempt.attempt_number == 1
    assert second_attempt.attempt_number == 2
    assert completed_stage.attempt_count == 2
    assert completed_stage.success is True
    assert completed_stage.used_hint is True
    assert completed_stage.completed_at is not None
    assert completed_session.completion_status == "completed"
    assert completed_session.completed_at is not None
    assert event.event_type == "hint_opened"
    assert response.answer_text is not None

    database_session: Session = repository.database_session
    assert len(database_session.scalars(select(Attempt)).all()) == 2
    assert len(database_session.scalars(select(InteractionEvent)).all()) == 1
    assert len(database_session.scalars(select(Response)).all()) == 1
    saved_stage = database_session.scalar(select(StageRun))
    assert saved_stage is not None
    assert saved_stage.final_top1_label == "traffic light"


def test_repository_rolls_back_duplicate_participant_code(
    repository: ResearchRepository,
) -> None:
    repository.create_participant("P102")

    with pytest.raises(DatabaseConflictError, match="integrity constraint"):
        repository.create_participant("P102")

    assert repository.get_participant_by_code("P102") is not None


def test_repository_rejects_missing_or_cross_session_parents(
    repository: ResearchRepository,
) -> None:
    with pytest.raises(RecordNotFoundError, match="Participant does not exist"):
        repository.create_session("missing-participant", game_version="mvp")

    first_participant = repository.create_participant("P103")
    second_participant = repository.create_participant("P104")
    first_session = repository.create_session(first_participant.id, "mvp")
    second_session = repository.create_session(second_participant.id, "mvp")
    first_stage = repository.start_stage_run(
        first_session.id,
        case_id="transfer-icecream-pixel",
        stage="transfer",
        attack_type="fgsm",
    )

    with pytest.raises(DatabaseConflictError, match="does not belong"):
        repository.save_response(
            second_session.id,
            question_key="transfer_explanation",
            question_version=1,
            answer_type="text",
            stage_run_id=first_stage.id,
            answer_text="This response must not be attached across sessions.",
        )
