"""
Create and share image classification service object,
FastAPI can get classifier through get_inference_service(),
real classifier can be replaced with a fake classifier in some tests
"""
from functools import lru_cache

from backend.app.inference import ImageClassifier, ResNet34InferenceService


@lru_cache(maxsize=1)
def get_inference_service() -> ImageClassifier:
    """Return one shared inference service for the lifetime of the process."""
    return ResNet34InferenceService()
