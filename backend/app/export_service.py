"""Anonymous JSON and analysis-friendly CSV research exports."""

from __future__ import annotations

import csv
import json
from datetime import datetime
from io import StringIO
from typing import Any

from backend.app.repositories.research_repository import ResearchRepository


CSV_FIELDS = [
    "record_type",
    "participant_code",
    "background_json",
    "session_id",
    "stage_run_id",
    "record_id",
    "game_version",
    "study_phase",
    "consent_version",
    "consent_confirmed_at",
    "stage",
    "case_id",
    "attack_type",
    "completion_status",
    "success",
    "started_at",
    "completed_at",
    "attempt_number",
    "tool_type",
    "parameters_before_json",
    "parameters_after_json",
    "predicted_outcome",
    "prediction_reason",
    "top1_before",
    "top1_after",
    "top5_after_json",
    "classification_changed",
    "correct_label_is_top1",
    "classification_restored",
    "attempt_count",
    "initial_top1_label",
    "final_top1_label",
    "used_hint",
    "fallback_shown",
    "inference_duration_ms",
    "event_type",
    "event_data_json",
    "question_key",
    "question_version",
    "answer_type",
    "answer_text",
    "answer_value",
    "answer_json",
    "created_at",
]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _json_value(value: Any) -> str:
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _csv_safe(value: Any) -> Any:
    """Prevent spreadsheet applications from evaluating user text as a formula."""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value}"
    return value


class ResearchExportService:
    """Serialize one anonymous Session without exposing local asset paths."""

    def __init__(self, repository: ResearchRepository) -> None:
        self.repository = repository

    def build_json(self, session_id: str) -> dict[str, Any]:
        records = self.repository.get_session_export_records(session_id)
        participant = records["participant"]
        session = records["session"]
        stage_runs = records["stage_runs"]
        attempts_by_stage: dict[str, list[Any]] = {}
        events_by_stage: dict[str | None, list[Any]] = {}
        responses_by_stage: dict[str | None, list[Any]] = {}
        for attempt in records["attempts"]:
            attempts_by_stage.setdefault(attempt.stage_run_id, []).append(attempt)
        for event in records["events"]:
            events_by_stage.setdefault(event.stage_run_id, []).append(event)
        for response in records["responses"]:
            responses_by_stage.setdefault(response.stage_run_id, []).append(response)

        return {
            "export_version": 1,
            "participant": {
                "participant_code": participant.participant_code,
                "background": participant.background,
                "created_at": _iso(participant.created_at),
            },
            "session": {
                "id": session.id,
                "game_version": session.game_version,
                "study_phase": session.study_phase,
                "completion_status": session.completion_status,
                "consent_version": session.consent_version,
                "consent_confirmed_at": _iso(session.consent_confirmed_at),
                "started_at": _iso(session.started_at),
                "completed_at": _iso(session.completed_at),
            },
            "stage_runs": [
                self._stage_json(
                    stage_run,
                    attempts_by_stage.get(stage_run.id, []),
                    events_by_stage.get(stage_run.id, []),
                    responses_by_stage.get(stage_run.id, []),
                )
                for stage_run in stage_runs
            ],
            "session_events": [
                self._event_json(event) for event in events_by_stage.get(None, [])
            ],
            "session_responses": [
                self._response_json(response)
                for response in responses_by_stage.get(None, [])
            ],
        }

    def build_csv(self, session_id: str) -> str:
        records = self.repository.get_session_export_records(session_id)
        participant = records["participant"]
        session = records["session"]
        stage_by_id = {stage.id: stage for stage in records["stage_runs"]}
        rows: list[dict[str, Any]] = [
            {
                "record_type": "session",
                "participant_code": participant.participant_code,
                "background_json": _json_value(participant.background),
                "session_id": session.id,
                "record_id": session.id,
                "game_version": session.game_version,
                "study_phase": session.study_phase,
                "consent_version": session.consent_version,
                "consent_confirmed_at": _iso(session.consent_confirmed_at),
                "completion_status": session.completion_status,
                "started_at": _iso(session.started_at),
                "completed_at": _iso(session.completed_at),
                "created_at": _iso(participant.created_at),
            }
        ]
        for stage in records["stage_runs"]:
            rows.append(
                self._base_csv_row("stage", participant.participant_code, session, stage)
                | {
                    "record_id": stage.id,
                    "completion_status": stage.completion_status,
                    "success": stage.success,
                    "started_at": _iso(stage.started_at),
                    "completed_at": _iso(stage.completed_at),
                    "attempt_count": stage.attempt_count,
                    "initial_top1_label": stage.initial_top1_label,
                    "final_top1_label": stage.final_top1_label,
                    "used_hint": stage.used_hint,
                    "fallback_shown": stage.fallback_shown,
                    "classification_restored": stage.classification_restored,
                }
            )
        for attempt in records["attempts"]:
            stage = stage_by_id[attempt.stage_run_id]
            rows.append(
                self._base_csv_row("attempt", participant.participant_code, session, stage)
                | {
                    "record_id": attempt.id,
                    "attempt_number": attempt.attempt_number,
                    "tool_type": attempt.tool_type,
                    "parameters_before_json": _json_value(attempt.parameters_before),
                    "parameters_after_json": _json_value(attempt.parameters_after),
                    "predicted_outcome": attempt.predicted_outcome,
                    "prediction_reason": attempt.prediction_reason,
                    "top1_before": attempt.top1_before,
                    "top1_after": attempt.top1_after,
                    "top5_after_json": _json_value(attempt.top5_after),
                    "classification_changed": attempt.classification_changed,
                    "correct_label_is_top1": attempt.correct_label_is_top1,
                    "classification_restored": attempt.classification_restored,
                    "inference_duration_ms": attempt.inference_duration_ms,
                    "created_at": _iso(attempt.created_at),
                }
            )
        for event in records["events"]:
            stage = stage_by_id.get(event.stage_run_id)
            rows.append(
                self._base_csv_row("event", participant.participant_code, session, stage)
                | {
                    "record_id": event.id,
                    "event_type": event.event_type,
                    "event_data_json": _json_value(event.event_data),
                    "created_at": _iso(event.created_at),
                }
            )
        for response in records["responses"]:
            stage = stage_by_id.get(response.stage_run_id)
            rows.append(
                self._base_csv_row("response", participant.participant_code, session, stage)
                | {
                    "record_id": response.id,
                    "question_key": response.question_key,
                    "question_version": response.question_version,
                    "answer_type": response.answer_type,
                    "answer_text": response.answer_text,
                    "answer_value": response.answer_value,
                    "answer_json": _json_value(response.answer_json),
                    "created_at": _iso(response.created_at),
                }
            )

        output = StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(
            {key: _csv_safe(row.get(key, "")) for key in CSV_FIELDS} for row in rows
        )
        return output.getvalue()

    def _stage_json(
        self,
        stage: Any,
        attempts: list[Any],
        events: list[Any],
        responses: list[Any],
    ) -> dict[str, Any]:
        return {
            "id": stage.id,
            "case_id": stage.case_id,
            "stage": stage.stage,
            "attack_type": stage.attack_type,
            "completion_status": stage.completion_status,
            "success": stage.success,
            "attempt_count": stage.attempt_count,
            "used_hint": stage.used_hint,
            "fallback_shown": stage.fallback_shown,
            "initial_top1_label": stage.initial_top1_label,
            "final_top1_label": stage.final_top1_label,
            "classification_restored": stage.classification_restored,
            "started_at": _iso(stage.started_at),
            "completed_at": _iso(stage.completed_at),
            "attempts": [self._attempt_json(attempt) for attempt in attempts],
            "events": [self._event_json(event) for event in events],
            "responses": [self._response_json(response) for response in responses],
        }

    def _attempt_json(self, attempt: Any) -> dict[str, Any]:
        return {
            "id": attempt.id,
            "attempt_number": attempt.attempt_number,
            "tool_type": attempt.tool_type,
            "parameters_before": attempt.parameters_before,
            "parameters_after": attempt.parameters_after,
            "predicted_outcome": attempt.predicted_outcome,
            "prediction_reason": attempt.prediction_reason,
            "top1_before": attempt.top1_before,
            "top1_after": attempt.top1_after,
            "top5_after": attempt.top5_after,
            "classification_changed": attempt.classification_changed,
            "correct_label_is_top1": attempt.correct_label_is_top1,
            "classification_restored": attempt.classification_restored,
            "inference_duration_ms": attempt.inference_duration_ms,
            "created_at": _iso(attempt.created_at),
        }

    def _event_json(self, event: Any) -> dict[str, Any]:
        return {
            "id": event.id,
            "event_type": event.event_type,
            "event_data": event.event_data,
            "created_at": _iso(event.created_at),
        }

    def _response_json(self, response: Any) -> dict[str, Any]:
        return {
            "id": response.id,
            "question_key": response.question_key,
            "question_version": response.question_version,
            "answer_type": response.answer_type,
            "answer_text": response.answer_text,
            "answer_value": response.answer_value,
            "answer_json": response.answer_json,
            "created_at": _iso(response.created_at),
        }

    def _base_csv_row(
        self, record_type: str, participant_code: str, session: Any, stage: Any | None
    ) -> dict[str, Any]:
        return {
            "record_type": record_type,
            "participant_code": participant_code,
            "session_id": session.id,
            "game_version": session.game_version,
            "study_phase": session.study_phase,
            "consent_version": session.consent_version,
            "consent_confirmed_at": _iso(session.consent_confirmed_at),
            "stage_run_id": stage.id if stage is not None else "",
            "stage": stage.stage if stage is not None else "",
            "case_id": stage.case_id if stage is not None else "",
            "attack_type": stage.attack_type if stage is not None else "",
        }
