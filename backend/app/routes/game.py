"""Player-facing case, image manipulation, and reclassification endpoints."""

from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from backend.app.case_catalog import CaseCatalogError, CaseNotFoundError
from backend.app.dependencies import get_complex_transfer_service, get_game_service
from backend.app.complex_transfer import ComplexTransferStateError
from backend.app.complex_transfer_service import ComplexTransferService
from backend.app.game_schemas import (
    FixedChoiceRequest,
    GameActionRead,
    PlayerCaseRead,
    PreviewRead,
    PreviewRequest,
    ReclassifyRequest,
    ComplexTransferActionRead,
    ComplexTransferPreviewRead,
    ComplexTransferPreviewRequest,
    ComplexTransferReclassifyRequest,
    ComplexTransferRunRead,
    ComplexTransferReflectionRead,
    ComplexTransferReflectionRequest,
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


@router.post(
    "/sessions/{session_id}/complex-transfer",
    response_model=ComplexTransferRunRead,
    status_code=status.HTTP_201_CREATED,
)
def initialize_complex_transfer(
    session_id: str,
    service: ComplexTransferService = Depends(get_complex_transfer_service),
) -> ComplexTransferRunRead:
    try:
        return service.initialize(session_id)
    except (RecordNotFoundError, ComplexTransferStateError) as error:
        if isinstance(error, ComplexTransferStateError):
            _raise_game_http_error(GameConflictError(str(error)))
        _raise_game_http_error(error)


@router.post(
    "/complex-transfer-runs/{stage_run_id}/preview",
    response_model=ComplexTransferPreviewRead,
)
def preview_complex_transfer(
    stage_run_id: str,
    request: ComplexTransferPreviewRequest,
    service: ComplexTransferService = Depends(get_complex_transfer_service),
) -> ComplexTransferPreviewRead:
    try:
        return service.preview(stage_run_id, request.selected_factor, request.parameters)
    except (RecordNotFoundError, ComplexTransferStateError) as error:
        _raise_game_http_error(GameConflictError(str(error)))


@router.post(
    "/complex-transfer-runs/{stage_run_id}/reclassify",
    response_model=ComplexTransferActionRead,
    status_code=status.HTTP_201_CREATED,
)
def reclassify_complex_transfer_run(
    stage_run_id: str,
    request: ComplexTransferReclassifyRequest,
    service: ComplexTransferService = Depends(get_complex_transfer_service),
) -> ComplexTransferActionRead:
    try:
        return service.reclassify(
            stage_run_id,
            request.selected_factor,
            request.prediction,
            request.prediction_reason,
            request.parameters,
        )
    except (RecordNotFoundError, ComplexTransferStateError) as error:
        _raise_game_http_error(GameConflictError(str(error)))


@router.get(
    "/complex-transfer-runs/{stage_run_id}/reflection",
    response_model=ComplexTransferReflectionRead,
)
def read_complex_transfer_reflection(
    stage_run_id: str,
    service: ComplexTransferService = Depends(get_complex_transfer_service),
) -> ComplexTransferReflectionRead:
    try:
        return service.read_reflection(stage_run_id)
    except (RecordNotFoundError, ComplexTransferStateError) as error:
        _raise_game_http_error(
            error if isinstance(error, RecordNotFoundError) else GameConflictError(str(error))
        )


@router.post(
    "/complex-transfer-runs/{stage_run_id}/reflection",
    response_model=ComplexTransferReflectionRead,
)
def save_complex_transfer_reflection(
    stage_run_id: str,
    request: ComplexTransferReflectionRequest,
    service: ComplexTransferService = Depends(get_complex_transfer_service),
) -> ComplexTransferReflectionRead:
    try:
        return service.save_reflection(
            stage_run_id,
            request.learning_reflection,
            request.new_error_strategy,
        )
    except (RecordNotFoundError, ComplexTransferStateError) as error:
        _raise_game_http_error(
            error if isinstance(error, RecordNotFoundError) else GameConflictError(str(error))
        )


@router.get("/complex-transfer-runs/{stage_run_id}/initial/image")
def read_complex_transfer_initial_image(stage_run_id: str, service: ComplexTransferService = Depends(get_complex_transfer_service)) -> FileResponse:
    return FileResponse(service.initial_image_path(stage_run_id))


@router.get("/complex-transfer-runs/{stage_run_id}/original/image")
def read_complex_transfer_original_image(stage_run_id: str, service: ComplexTransferService = Depends(get_complex_transfer_service)) -> FileResponse:
    return FileResponse(service.original_image_path(stage_run_id))


@router.get("/complex-transfer-runs/{stage_run_id}/preview/image")
def read_complex_transfer_preview_image(stage_run_id: str, service: ComplexTransferService = Depends(get_complex_transfer_service)) -> FileResponse:
    return FileResponse(service.preview_image_path(stage_run_id), headers={"Cache-Control": "no-store"})


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
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@router.get("/cases/{case_id}/original-image")
def read_case_original_image(
    case_id: str,
    game_service: GameService = Depends(get_game_service),
) -> FileResponse:
    try:
        path = game_service.get_case_original_image_path(case_id)
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
    return FileResponse(path, headers={"Cache-Control": "no-store"})
