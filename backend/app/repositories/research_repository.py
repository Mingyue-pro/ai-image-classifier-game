"""Data-access operations for anonymous game and research records."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.database_models import (
    Attempt,
    InteractionEvent,
    Participant,
    ResearchSession,
    Response,
    StageRun,
    utc_now,
)


class RecordNotFoundError(ValueError):
    """Raised when a requested parent or record does not exist."""


class DatabaseConflictError(ValueError):
    """Raised when a uniqueness or other integrity constraint is violated."""


class ResearchRepository:
    """Store and retrieve one request's research data using a SQLAlchemy session."""

    def __init__(self, database_session: Session) -> None:
        self.database_session = database_session

    def _commit_and_refresh(self, record: Any) -> Any:
        try:
            self.database_session.commit()
        except IntegrityError as error:
            self.database_session.rollback()
            raise DatabaseConflictError("Database integrity constraint failed") from error
        self.database_session.refresh(record)
        return record

    def get_participant_by_code(self, participant_code: str) -> Participant | None:
        """Return an anonymous participant or None when the code is unknown."""
        return self.database_session.scalar(
            select(Participant).where(
                Participant.participant_code == participant_code
            )
        )

    def create_participant(
        self,
        participant_code: str,
        background: dict[str, Any] | None = None,
    ) -> Participant:
        """Create one anonymous participant record."""
        participant = Participant(
            participant_code=participant_code,
            background=background,
        )
        self.database_session.add(participant)
        return self._commit_and_refresh(participant)

    def create_session(
        self,
        participant_id: str,
        game_version: str,
        study_phase: str | None = None,
        consent_version: str | None = None,
        consent_confirmed_at: datetime | None = None,
    ) -> ResearchSession:
        """Start one game or research session for an existing participant."""
        self._require_participant(participant_id)
        research_session = ResearchSession(
            participant_id=participant_id,
            game_version=game_version,
            study_phase=study_phase,
            consent_version=consent_version,
            consent_confirmed_at=consent_confirmed_at,
        )
        self.database_session.add(research_session)
        return self._commit_and_refresh(research_session)

    def start_stage_run(
        self,
        session_id: str,
        case_id: str,
        stage: str,
        attack_type: str,
        initial_top1_label: str | None = None,
    ) -> StageRun:
        """Start one configured Stage or Transfer case."""
        self._require_session(session_id)
        stage_run = StageRun(
            session_id=session_id,
            case_id=case_id,
            stage=stage,
            attack_type=attack_type,
            initial_top1_label=initial_top1_label,
        )
        self.database_session.add(stage_run)
        return self._commit_and_refresh(stage_run)

    def record_attempt(
        self,
        stage_run_id: str,
        tool_type: str,
        parameters_after: dict[str, Any],
        top1_after: str,
        classification_changed: bool,
        correct_label_is_top1: bool,
        classification_restored: bool,
        *,
        parameters_before: dict[str, Any] | None = None,
        predicted_outcome: str | None = None,
        prediction_reason: str | None = None,
        top1_before: str | None = None,
        top5_after: list[dict[str, Any]] | None = None,
        output_image_path: str | None = None,
        inference_duration_ms: float | None = None,
    ) -> Attempt:
        """Save one submitted manipulation and increment its Stage attempt count."""
        stage_run = self._require_stage_run(stage_run_id)
        attempt_number = stage_run.attempt_count + 1
        attempt = Attempt(
            stage_run_id=stage_run_id,
            attempt_number=attempt_number,
            tool_type=tool_type,
            parameters_before=parameters_before,
            parameters_after=parameters_after,
            predicted_outcome=predicted_outcome,
            prediction_reason=prediction_reason,
            top1_before=top1_before,
            top1_after=top1_after,
            top5_after=top5_after,
            classification_changed=classification_changed,
            correct_label_is_top1=correct_label_is_top1,
            classification_restored=classification_restored,
            output_image_path=output_image_path,
            inference_duration_ms=inference_duration_ms,
        )
        stage_run.attempt_count = attempt_number
        stage_run.final_top1_label = top1_after
        stage_run.classification_restored = classification_restored
        self.database_session.add(attempt)
        return self._commit_and_refresh(attempt)

    def record_event(
        self,
        session_id: str,
        event_type: str,
        event_data: dict[str, Any] | None = None,
        stage_run_id: str | None = None,
    ) -> InteractionEvent:
        """Save a meaningful action that does not itself run inference."""
        self._require_session(session_id)
        if stage_run_id is not None:
            stage_run = self._require_stage_run(stage_run_id)
            if stage_run.session_id != session_id:
                raise DatabaseConflictError(
                    "Stage run does not belong to the supplied session"
                )
        interaction_event = InteractionEvent(
            session_id=session_id,
            stage_run_id=stage_run_id,
            event_type=event_type,
            event_data=event_data,
        )
        self.database_session.add(interaction_event)
        return self._commit_and_refresh(interaction_event)

    def save_response(
        self,
        session_id: str,
        question_key: str,
        question_version: int,
        answer_type: str,
        *,
        stage_run_id: str | None = None,
        answer_text: str | None = None,
        answer_value: str | None = None,
        answer_json: Any | None = None,
    ) -> Response:
        """Save a versioned open, choice, multiple-choice, or scale answer."""
        self._require_session(session_id)
        if stage_run_id is not None:
            stage_run = self._require_stage_run(stage_run_id)
            if stage_run.session_id != session_id:
                raise DatabaseConflictError(
                    "Stage run does not belong to the supplied session"
                )
        response = Response(
            session_id=session_id,
            stage_run_id=stage_run_id,
            question_key=question_key,
            question_version=question_version,
            answer_type=answer_type,
            answer_text=answer_text,
            answer_value=answer_value,
            answer_json=answer_json,
        )
        self.database_session.add(response)
        return self._commit_and_refresh(response)

    def complete_stage_run(
        self,
        stage_run_id: str,
        *,
        success: bool,
        final_top1_label: str | None = None,
        classification_restored: bool | None = None,
        completion_status: str = "completed",
        used_hint: bool | None = None,
        fallback_shown: bool | None = None,
    ) -> StageRun:
        """Finish one Stage while preserving its accumulated attempt count."""
        stage_run = self._require_stage_run(stage_run_id)
        stage_run.success = success
        stage_run.completion_status = completion_status
        stage_run.completed_at = utc_now()
        if final_top1_label is not None:
            stage_run.final_top1_label = final_top1_label
        if classification_restored is not None:
            stage_run.classification_restored = classification_restored
        if used_hint is not None:
            stage_run.used_hint = used_hint
        if fallback_shown is not None:
            stage_run.fallback_shown = fallback_shown
        return self._commit_and_refresh(stage_run)

    def complete_session(
        self,
        session_id: str,
        completion_status: str = "completed",
    ) -> ResearchSession:
        """Finish one complete game or research session."""
        research_session = self._require_session(session_id)
        research_session.completion_status = completion_status
        research_session.completed_at = utc_now()
        return self._commit_and_refresh(research_session)

    def _require_participant(self, participant_id: str) -> Participant:
        participant = self.database_session.get(Participant, participant_id)
        if participant is None:
            raise RecordNotFoundError(f"Participant does not exist: {participant_id}")
        return participant

    def _require_session(self, session_id: str) -> ResearchSession:
        research_session = self.database_session.get(ResearchSession, session_id)
        if research_session is None:
            raise RecordNotFoundError(f"Session does not exist: {session_id}")
        return research_session

    def _require_stage_run(self, stage_run_id: str) -> StageRun:
        stage_run = self.database_session.get(StageRun, stage_run_id)
        if stage_run is None:
            raise RecordNotFoundError(f"Stage run does not exist: {stage_run_id}")
        return stage_run
