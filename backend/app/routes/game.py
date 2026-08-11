"""Player-facing case, image manipulation, and reclassification endpoints."""

from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from backend.app.case_catalog import CaseCatalogError, CaseNotFoundError
from backend.app.dependencies import get_game_service
from backend.app.game_schemas import (
    FixedChoiceRequest,
    GameActionRead,
    PlayerCaseRead,
    PreviewRead,
    PreviewRequest,
    ReclassifyRequest,
)
from backend.app.game_service import (
    GameAssetError,
    GameConflictError,
    GameInputError,
    GameService,
)
from backend.app.repositories.research_repository import (
    DatabaseConflictError,
    RecordNotFoundError,
)


router = APIRouter(prefix="/game", tags=["game"])


def _raise_game_http_error(error: ValueError) -> NoReturn:
    if isinstance(error, (CaseNotFoundError, RecordNotFoundError)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, (GameConflictError, DatabaseConflictError)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, GameInputError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        )
    if isinstance(error, (GameAssetError, CaseCatalogError)):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        )
    raise error


@router.get("/cases/{case_id}", response_model=PlayerCaseRead)
def read_player_case(
    case_id: str,
    game_service: GameService = Depends(get_game_service),
) -> PlayerCaseRead:
    try:
        return game_service.get_player_case(case_id)
    except (CaseCatalogError, GameAssetError, GameInputError) as error:
        _raise_game_http_error(error)


@router.get("/cases/{case_id}/states/{state_id}/image")
def read_case_image(
    case_id: str,
    state_id: str,
    game_service: GameService = Depends(get_game_service),
) -> FileResponse:
    try:
        path = game_service.get_case_image_path(case_id, state_id)
    except (CaseCatalogError, GameAssetError, GameInputError) as error:
        _raise_game_http_error(error)
    return FileResponse(path)


@router.post(
    "/stage-runs/{stage_run_id}/apply-choice",
    response_model=GameActionRead,
    status_code=status.HTTP_201_CREATED,
)
def apply_fixed_choice(
    stage_run_id: str,
    request: FixedChoiceRequest,
    game_service: GameService = Depends(get_game_service),
) -> GameActionRead:
    try:
        return game_service.apply_fixed_choice(
            stage_run_id,
            request.state_id,
            request.predicted_outcome,
            request.prediction_reason,
        )
    except (
        CaseCatalogError,
        RecordNotFoundError,
        DatabaseConflictError,
        GameAssetError,
        GameInputError,
        GameConflictError,
    ) as error:
        _raise_game_http_error(error)


@router.post(
    "/stage-runs/{stage_run_id}/reclassify",
    response_model=GameActionRead,
    status_code=status.HTTP_201_CREATED,
)
def reclassify_runtime_image(
    stage_run_id: str,
    request: ReclassifyRequest,
    game_service: GameService = Depends(get_game_service),
) -> GameActionRead:
    try:
        return game_service.reclassify(
            stage_run_id,
            request.tool_type,
            request.parameters,
            request.predicted_outcome,
            request.prediction_reason,
        )
    except (
        CaseCatalogError,
        RecordNotFoundError,
        DatabaseConflictError,
        GameAssetError,
        GameInputError,
        GameConflictError,
    ) as error:
        _raise_game_http_error(error)


@router.post(
    "/stage-runs/{stage_run_id}/apply-fallback",
    response_model=GameActionRead,
    status_code=status.HTTP_201_CREATED,
)
def apply_verified_fallback(
    stage_run_id: str,
    game_service: GameService = Depends(get_game_service),
) -> GameActionRead:
    try:
        return game_service.apply_fallback(stage_run_id)
    except (
        CaseCatalogError,
        RecordNotFoundError,
        DatabaseConflictError,
        GameAssetError,
        GameInputError,
        GameConflictError,
    ) as error:
        _raise_game_http_error(error)


@router.post(
    "/stage-runs/{stage_run_id}/preview",
    response_model=PreviewRead,
)
def preview_runtime_image(
    stage_run_id: str,
    request: PreviewRequest,
    game_service: GameService = Depends(get_game_service),
) -> PreviewRead:
    try:
        return game_service.preview(stage_run_id, request.tool_type, request.parameters)
    except (
        CaseCatalogError,
        RecordNotFoundError,
        DatabaseConflictError,
        GameAssetError,
        GameInputError,
        GameConflictError,
    ) as error:
        _raise_game_http_error(error)


@router.get("/stage-runs/{stage_run_id}/preview/image")
def read_preview_image(
    stage_run_id: str,
    game_service: GameService = Depends(get_game_service),
) -> FileResponse:
    try:
        path = game_service.get_preview_image_path(stage_run_id)
    except (
        RecordNotFoundError,
        CaseCatalogError,
        GameAssetError,
        GameInputError,
        GameConflictError,
    ) as error:
        _raise_game_http_error(error)
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@router.get("/stage-runs/{stage_run_id}/attempts/{attempt_number}/image")
def read_attempt_image(
    stage_run_id: str,
    attempt_number: int,
    game_service: GameService = Depends(get_game_service),
) -> FileResponse:
    try:
        path = game_service.get_attempt_image_path(stage_run_id, attempt_number)
    except (
        RecordNotFoundError,
        CaseCatalogError,
        GameAssetError,
        GameInputError,
    ) as error:
        _raise_game_http_error(error)
    return FileResponse(path)
