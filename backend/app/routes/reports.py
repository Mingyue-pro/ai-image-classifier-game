"""Participant-facing Investigator Report endpoint."""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.app.dependencies import get_investigator_report_service
from backend.app.report_service import InvestigatorReportService
from backend.app.repositories.research_repository import RecordNotFoundError


router = APIRouter(prefix="/research/sessions", tags=["research-reports"])


@router.get("/{session_id}/report")
def get_investigator_report(
    session_id: str,
    report_service: InvestigatorReportService = Depends(get_investigator_report_service),
) -> dict:
    try:
        return report_service.build(session_id)
    except RecordNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
