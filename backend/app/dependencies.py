"""
Create and share image classification service object,
FastAPI can get classifier through get_inference_service(),
real classifier can be replaced with a fake classifier in some tests
"""
from functools import lru_cache
from pathlib import Path

from fastapi import Depends
from sqlalchemy.orm import Session

from backend.app.case_catalog import CaseCatalog, configured_case_matrix_path
from backend.app.database import get_database_session
from backend.app.inference import ImageClassifier, ResNet34InferenceService
from backend.app.game_service import GameService
from backend.app.repositories.research_repository import ResearchRepository


@lru_cache(maxsize=1)
def get_inference_service() -> ImageClassifier:
    """Return one shared inference service for the lifetime of the process."""
    return ResNet34InferenceService()


def get_research_repository(
    database_session: Session = Depends(get_database_session),
) -> ResearchRepository:
    """Return one repository backed by the current request's database session."""
    return ResearchRepository(database_session)


@lru_cache(maxsize=1)
def get_case_catalog() -> CaseCatalog:
    """Return the shared read-only validated case catalog."""
    return CaseCatalog(configured_case_matrix_path())


def get_game_service(
    case_catalog: CaseCatalog = Depends(get_case_catalog),
    repository: ResearchRepository = Depends(get_research_repository),
    classifier: ImageClassifier = Depends(get_inference_service),
) -> GameService:
    """Combine trusted case, persistence, manipulation, and inference services."""
    project_root = Path.cwd().resolve()
    return GameService(
        case_catalog=case_catalog,
        repository=repository,
        classifier=classifier,
        project_root=project_root,
        runtime_root=project_root / "data" / "runtime",
    )
