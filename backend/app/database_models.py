"""SQLAlchemy models for anonymous game and research data."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_identifier() -> str:
    """Return a portable UUID string for a new database record."""
    return str(uuid4())


def utc_now() -> datetime:
    """Return the current UTC time for a new database record."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Base class shared by all application database tables."""


class Participant(Base):
    """One anonymous participant; no direct identity fields are stored."""

    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_identifier
    )
    participant_code: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    background: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    sessions: Mapped[list[ResearchSession]] = relationship(
        back_populates="participant",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ResearchSession(Base):
    """One complete game or research run for an anonymous participant."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_identifier
    )
    participant_id: Mapped[str] = mapped_column(
        ForeignKey("participants.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    game_version: Mapped[str] = mapped_column(String(64), nullable=False)
    study_phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    completion_status: Mapped[str] = mapped_column(
        String(32), default="in_progress", nullable=False
    )
    consent_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    consent_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    participant: Mapped[Participant] = relationship(back_populates="sessions")
    stage_runs: Mapped[list[StageRun]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    interaction_events: Mapped[list[InteractionEvent]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    responses: Mapped[list[Response]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class StageRun(Base):
    """Summary of one participant working through one configured case."""

    __tablename__ = "stage_runs"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_stage_runs_attempt_count"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_identifier
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    case_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    attack_type: Mapped[str] = mapped_column(String(32), nullable=False)
    completion_status: Mapped[str] = mapped_column(
        String(32), default="in_progress", nullable=False
    )
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used_hint: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fallback_shown: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    initial_top1_label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    final_top1_label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    classification_restored: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    session: Mapped[ResearchSession] = relationship(back_populates="stage_runs")
    attempts: Mapped[list[Attempt]] = relationship(
        back_populates="stage_run",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    interaction_events: Mapped[list[InteractionEvent]] = relationship(
        back_populates="stage_run"
    )
    responses: Mapped[list[Response]] = relationship(back_populates="stage_run")


class Attempt(Base):
    """One submitted manipulation followed by real model reclassification."""

    __tablename__ = "attempts"
    __table_args__ = (
        UniqueConstraint(
            "stage_run_id",
            "attempt_number",
            name="uq_attempts_stage_run_number",
        ),
        CheckConstraint("attempt_number > 0", name="ck_attempts_attempt_number"),
        CheckConstraint(
            "inference_duration_ms IS NULL OR inference_duration_ms >= 0",
            name="ck_attempts_inference_duration",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_identifier
    )
    stage_run_id: Mapped[str] = mapped_column(
        ForeignKey("stage_runs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    tool_type: Mapped[str] = mapped_column(String(64), nullable=False)
    parameters_before: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True
    )
    parameters_after: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    predicted_outcome: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prediction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    top1_before: Mapped[str | None] = mapped_column(String(256), nullable=True)
    top1_after: Mapped[str] = mapped_column(String(256), nullable=False)
    top5_after: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, nullable=True
    )
    classification_changed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    correct_label_is_top1: Mapped[bool] = mapped_column(Boolean, nullable=False)
    classification_restored: Mapped[bool] = mapped_column(Boolean, nullable=False)
    output_image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    inference_duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    stage_run: Mapped[StageRun] = relationship(back_populates="attempts")


class InteractionEvent(Base):
    """A meaningful non-inference action such as hint, undo, or exit."""

    __tablename__ = "interaction_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_identifier
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    stage_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("stage_runs.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    event_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    session: Mapped[ResearchSession] = relationship(
        back_populates="interaction_events"
    )
    stage_run: Mapped[StageRun | None] = relationship(
        back_populates="interaction_events"
    )


class Response(Base):
    """One versioned open, choice, multiple-choice, or scale answer."""

    __tablename__ = "responses"
    __table_args__ = (
        CheckConstraint("question_version > 0", name="ck_responses_question_version"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_identifier
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    stage_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("stage_runs.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    question_key: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    question_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    answer_type: Mapped[str] = mapped_column(String(32), nullable=False)
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer_value: Mapped[str | None] = mapped_column(String(256), nullable=True)
    answer_json: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    session: Mapped[ResearchSession] = relationship(back_populates="responses")
    stage_run: Mapped[StageRun | None] = relationship(back_populates="responses")
