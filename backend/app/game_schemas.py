"""Pydantic schemas for player-safe cases and trusted game actions."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from backend.app.schemas import Prediction


class PlayerCaseState(BaseModel):
    state_id: str
    role: str
    image_url: str
    parameters: dict[str, Any]


class PlayerCaseRead(BaseModel):
    case_id: str
    stage: str
    subject: str
    attack_type: str
    interaction_mode: str
    correct_label: str
    initial_state_id: str
    initial_image_url: str
    initial_top1: Prediction
    parameter_rules: list[dict[str, Any]]
    max_attempts: int | None
    available_states: list[PlayerCaseState]


class FixedChoiceRequest(BaseModel):
    state_id: str = Field(min_length=1, max_length=128)
    predicted_outcome: str | None = Field(default=None, max_length=64)
    prediction_reason: str | None = Field(default=None, max_length=2000)


class ReclassifyRequest(BaseModel):
    tool_type: str = Field(min_length=1, max_length=64)
    parameters: dict[str, float]
    predicted_outcome: str | None = Field(default=None, max_length=64)
    prediction_reason: str | None = Field(default=None, max_length=2000)


class PreviewRequest(BaseModel):
    tool_type: str = Field(min_length=1, max_length=64)
    parameters: dict[str, float]


class PreviewRead(BaseModel):
    image_url: str
    parameters: dict[str, float]


class GameActionRead(BaseModel):
    attempt_number: int
    image_url: str
    top1: Prediction
    top5: list[Prediction]
    parameters: dict[str, Any]
    classification_changed: bool
    correct_label_is_top1: bool
    classification_restored: bool
    attempts_remaining: int | None


class PredictedClassExampleRead(BaseModel):
    image_url: str
    source: str
    alt: str


class PredictedClassExamplesRead(BaseModel):
    label: str
    examples: list[PredictedClassExampleRead]
