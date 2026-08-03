"""Pydantic request and response schemas for research data APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ParticipantCreate(BaseModel):
    participant_code: str = Field(min_length=1, max_length=64)
    background: dict[str, Any] | None = None


class ParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    participant_code: str
    background: dict[str, Any] | None
    created_at: datetime


class SessionCreate(BaseModel):
    participant_id: str
    game_version: str = Field(min_length=1, max_length=64)
    study_phase: str | None = Field(default=None, max_length=64)
    consent_version: str | None = Field(default=None, max_length=64)
    consent_confirmed: bool = False


class SessionUpdate(BaseModel):
    completion_status: Literal["completed", "exited"]


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    participant_id: str
    game_version: str
    study_phase: str | None
    completion_status: str
    consent_version: str | None
    consent_confirmed_at: datetime | None
    started_at: datetime
    completed_at: datetime | None


class StageRunCreate(BaseModel):
    case_id: str = Field(min_length=1, max_length=128)


class StageRunUpdate(BaseModel):
    completion_status: Literal["completed", "exited"]


class StageRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    case_id: str
    stage: str
    attack_type: str
    completion_status: str
    success: bool | None
    attempt_count: int
    used_hint: bool
    fallback_shown: bool
    initial_top1_label: str | None
    final_top1_label: str | None
    classification_restored: bool | None
    started_at: datetime
    completed_at: datetime | None


class EventCreate(BaseModel):
    event_type: str = Field(min_length=1, max_length=64)
    event_data: dict[str, Any] | None = None


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    stage_run_id: str | None
    event_type: str
    event_data: dict[str, Any] | None
    created_at: datetime


class ResponseCreate(BaseModel):
    question_key: str = Field(min_length=1, max_length=128)
    question_version: int = Field(default=1, gt=0)
    answer_type: Literal["text", "choice", "multiple_choice", "scale"]
    answer_text: str | None = None
    answer_value: str | None = Field(default=None, max_length=256)
    answer_json: Any | None = None

    @model_validator(mode="after")
    def require_matching_answer(self) -> ResponseCreate:
        if self.answer_type == "text" and not self.answer_text:
            raise ValueError("Text responses require answer_text")
        if self.answer_type in {"choice", "scale"} and self.answer_value is None:
            raise ValueError("Choice and scale responses require answer_value")
        if self.answer_type == "multiple_choice" and self.answer_json is None:
            raise ValueError("Multiple-choice responses require answer_json")
        return self


class ResponseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    stage_run_id: str | None
    question_key: str
    question_version: int
    answer_type: str
    answer_text: str | None
    answer_value: str | None
    answer_json: Any | None
    created_at: datetime
