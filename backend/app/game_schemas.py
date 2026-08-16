"""Pydantic schemas for player-safe cases and trusted game actions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.app.schemas import Prediction


class ComplexPatchState(BaseModel):
    size_fraction: float = Field(ge=0, le=1)
    position_x: float = Field(ge=0, le=1)
    position_y: float = Field(ge=0, le=1)


class ComplexTransferParametersRead(BaseModel):
    patch: ComplexPatchState
    pixel_strength: float = Field(ge=0, le=255)
    blur_level: Literal["none", "low", "medium", "high"]


class ComplexTransferAttemptRead(BaseModel):
    attempt_number: int
    selected_factor: Literal["patch", "pixel", "blur"]
    prediction: str
    before_parameters: ComplexTransferParametersRead
    after_parameters: ComplexTransferParametersRead
    before_classification: str
    after_classification: str
    classification_restored: bool
    timestamp: datetime


class ComplexTransferRunRead(BaseModel):
    stage_run_id: str
    image_url: str
    original_image_url: str
    expected_class: str
    current_top1: Prediction
    current_parameters: ComplexTransferParametersRead
    attempt_index: int
    remaining_attempts: int
    max_attempts: int
    success: bool
    finished: bool
    exhausted: bool
    initial_top1_label: str
    attempts: list[ComplexTransferAttemptRead]
    reference_recoverable_parameters: ComplexTransferParametersRead
    reference_top1_label: str


class ComplexTransferPreviewRequest(BaseModel):
    selected_factor: str
    parameters: ComplexTransferParametersRead


class ComplexTransferPreviewRead(BaseModel):
    image_url: str
    parameters: ComplexTransferParametersRead


class ComplexTransferReclassifyRequest(ComplexTransferPreviewRequest):
    prediction: str = Field(min_length=1, max_length=64)
    prediction_reason: str | None = Field(default=None, max_length=2000)


class ComplexTransferActionRead(BaseModel):
    stage_run_id: str
    attempt_index: int
    image_url: str
    selected_factor: str
    prediction: str
    before_parameters: ComplexTransferParametersRead
    after_parameters: ComplexTransferParametersRead
    before_top1: Prediction
    after_top1: Prediction
    classification_restored: bool
    remaining_attempts: int


class ComplexTransferReflectionRequest(BaseModel):
    learning_reflection: str = Field(min_length=1, max_length=10000)
    new_error_strategy: str = Field(min_length=1, max_length=10000)


class ComplexTransferReflectionRead(BaseModel):
    stage_run_id: str
    completed: bool
    learning_reflection: str | None = None
    new_error_strategy: str | None = None


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
    original_image_url: str
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
