"""
HTTP layer, responsible for:
 1. Receiving uploaded files
 2. Checking file types
 3. Reading image content
 4. Verifying images using Pillow
 5. Calling the inference service
 6. Returning the results as JSON
"""
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from backend.app.dependencies import get_inference_service
from backend.app.inference import ImageClassifier
from backend.app.schemas import ClassificationResponse


router = APIRouter(tags=["classification"])

SUPPORTED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/classify", response_model=ClassificationResponse)
async def classify_image(
    file: UploadFile = File(...),
    service: ImageClassifier = Depends(get_inference_service),
) -> ClassificationResponse:
    if file.content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported image type. Upload a JPEG, PNG, or WebP image.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded image is empty.",
        )

    try:
        image = Image.open(BytesIO(contents))
        # Decode the image now so corrupt data is rejected before inference
        image.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file does not contain a valid image.",
        ) from None
    finally:
        await file.close()

    return service.classify(image)
