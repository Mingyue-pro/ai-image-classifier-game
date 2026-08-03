"""Download one anonymous research Session as JSON or CSV."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.app.dependencies import get_research_export_service
from backend.app.export_service import ResearchExportService
from backend.app.repositories.research_repository import RecordNotFoundError


router = APIRouter(prefix="/research/sessions", tags=["research-exports"])


def _download_headers(session_id: str, extension: str) -> dict[str, str]:
    return {
        "Content-Disposition": (
            f'attachment; filename="anonymous-session-{session_id}.{extension}"'
        )
    }


@router.get("/{session_id}/export.json")
def export_session_json(
    session_id: str,
    export_service: ResearchExportService = Depends(get_research_export_service),
) -> Response:
    try:
        payload = export_service.build_json(session_id)
    except RecordNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_download_headers(session_id, "json"),
    )


@router.get("/{session_id}/export.csv")
def export_session_csv(
    session_id: str,
    export_service: ResearchExportService = Depends(get_research_export_service),
) -> Response:
    try:
        payload = export_service.build_csv(session_id)
    except RecordNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error
    return Response(
        content=payload,
        media_type="text/csv",
        headers=_download_headers(session_id, "csv"),
    )
