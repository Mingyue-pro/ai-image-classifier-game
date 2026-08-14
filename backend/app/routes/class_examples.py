"""Optional local examples for explaining an incorrect predicted class."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from backend.app.class_examples import (
    ClassExampleCatalog,
    ClassExampleCatalogError,
    ClassExampleNotFoundError,
)
from backend.app.dependencies import get_class_example_catalog
from backend.app.game_schemas import PredictedClassExamplesRead


router = APIRouter(prefix="/game/predicted-classes", tags=["game"])


@router.get("/{label}/examples", response_model=PredictedClassExamplesRead)
def read_predicted_class_examples(
    label: str,
    catalog: ClassExampleCatalog = Depends(get_class_example_catalog),
) -> PredictedClassExamplesRead:
    try:
        examples = catalog.examples_for(label)
    except ClassExampleCatalogError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    normalized_label = " ".join(label.strip().lower().split())
    return PredictedClassExamplesRead(label=normalized_label, examples=examples)


@router.get("/{label}/examples/{example_index}/image")
def read_predicted_class_example_image(
    label: str,
    example_index: int,
    catalog: ClassExampleCatalog = Depends(get_class_example_catalog),
) -> FileResponse:
    try:
        path = catalog.image_path(label, example_index)
    except ClassExampleNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except ClassExampleCatalogError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    return FileResponse(path, headers={"Cache-Control": "private, max-age=300"})
