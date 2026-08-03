"""HTTP endpoints for anonymous research sessions and participant responses."""

from __future__ import annotations

from typing import Any, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status

from backend.app.case_catalog import CaseCatalog, CaseCatalogError, CaseNotFoundError
from backend.app.database_models import utc_now
from backend.app.dependencies import get_case_catalog, get_research_repository
from backend.app.repositories.research_repository import (
    DatabaseConflictError,
    RecordNotFoundError,
    ResearchRepository,
)
from backend.app.research_schemas import (
    EventCreate,
    EventRead,
    ParticipantCreate,
    ParticipantRead,
    ResponseCreate,
    ResponseRead,
    SessionCreate,
    SessionRead,
    SessionUpdate,
    StageRunCreate,
    StageRunRead,
    StageRunUpdate,
)


router = APIRouter(prefix="/research", tags=["research"])


def _raise_repository_http_error(error: ValueError) -> NoReturn:
    if isinstance(error, RecordNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, DatabaseConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    raise error


def _required_case_text(case: dict[str, Any], field_name: str) -> str:
    value = case.get(field_name)
    if not isinstance(value, str) or not value:
        raise CaseCatalogError(f"Case is missing a valid {field_name}")
    return value


@router.post(
    "/participants",
    response_model=ParticipantRead,
    status_code=status.HTTP_201_CREATED,
)
def create_participant(
    request: ParticipantCreate,
    repository: ResearchRepository = Depends(get_research_repository),
) -> ParticipantRead:
    try:
        participant = repository.create_participant(
            request.participant_code,
            request.background,
        )
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return ParticipantRead.model_validate(participant)


@router.post(
    "/sessions",
    response_model=SessionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    request: SessionCreate,
    repository: ResearchRepository = Depends(get_research_repository),
) -> SessionRead:
    try:
        research_session = repository.create_session(
            request.participant_id,
            request.game_version,
            request.study_phase,
            request.consent_version,
            utc_now() if request.consent_confirmed else None,
        )
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return SessionRead.model_validate(research_session)


@router.patch("/sessions/{session_id}", response_model=SessionRead)
def update_session(
    session_id: str,
    request: SessionUpdate,
    repository: ResearchRepository = Depends(get_research_repository),
) -> SessionRead:
    try:
        research_session = repository.complete_session(
            session_id,
            request.completion_status,
        )
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return SessionRead.model_validate(research_session)


@router.post(
    "/sessions/{session_id}/stage-runs",
    response_model=StageRunRead,
    status_code=status.HTTP_201_CREATED,
)
def start_stage_run(
    session_id: str,
    request: StageRunCreate,
    repository: ResearchRepository = Depends(get_research_repository),
    case_catalog: CaseCatalog = Depends(get_case_catalog),
) -> StageRunRead:
    try:
        case = case_catalog.get_case(request.case_id)
        stage_run = repository.start_stage_run(
            session_id,
            case_id=request.case_id,
            stage=_required_case_text(case, "stage"),
            attack_type=_required_case_text(case, "attack_type"),
            initial_top1_label=case_catalog.get_initial_top1_label(case),
        )
    except CaseNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error
    except CaseCatalogError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return StageRunRead.model_validate(stage_run)


@router.patch("/stage-runs/{stage_run_id}", response_model=StageRunRead)
def update_stage_run(
    stage_run_id: str,
    request: StageRunUpdate,
    repository: ResearchRepository = Depends(get_research_repository),
) -> StageRunRead:
    try:
        stage_run = repository.get_stage_run(stage_run_id)
        completed_stage = repository.complete_stage_run(
            stage_run_id,
            success=stage_run.success,
            final_top1_label=stage_run.final_top1_label,
            classification_restored=stage_run.classification_restored,
            completion_status=request.completion_status,
        )
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return StageRunRead.model_validate(completed_stage)


@router.post(
    "/stage-runs/{stage_run_id}/events",
    response_model=EventRead,
    status_code=status.HTTP_201_CREATED,
)
def create_event(
    stage_run_id: str,
    request: EventCreate,
    repository: ResearchRepository = Depends(get_research_repository),
) -> EventRead:
    try:
        stage_run = repository.get_stage_run(stage_run_id)
        event = repository.record_event(
            stage_run.session_id,
            request.event_type,
            request.event_data,
            stage_run_id,
        )
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return EventRead.model_validate(event)


@router.post(
    "/stage-runs/{stage_run_id}/responses",
    response_model=ResponseRead,
    status_code=status.HTTP_201_CREATED,
)
def create_response(
    stage_run_id: str,
    request: ResponseCreate,
    repository: ResearchRepository = Depends(get_research_repository),
) -> ResponseRead:
    try:
        stage_run = repository.get_stage_run(stage_run_id)
        response = repository.save_response(
            stage_run.session_id,
            request.question_key,
            request.question_version,
            request.answer_type,
            stage_run_id=stage_run_id,
            answer_text=request.answer_text,
            answer_value=request.answer_value,
            answer_json=request.answer_json,
        )
    except (RecordNotFoundError, DatabaseConflictError) as error:
        _raise_repository_http_error(error)
    return ResponseRead.model_validate(response)
