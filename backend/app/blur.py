"""Reusable Gaussian Blur helpers for controlled image investigations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from PIL import Image, ImageFilter


BlurLevel = Literal["none", "low", "medium", "high"]

# Pillow's GaussianBlur radius is the Gaussian standard deviation in source
# image pixels. These values are intentionally discrete so a configured game
# case can store a stable, human-readable level alongside its numeric radius.
BLUR_RADII: dict[BlurLevel, float] = {
    "none": 0.0,
    "low": 4.0,
    "medium": 8.0,
    "high": 16.0,
}


@dataclass(frozen=True)
class BlurApplication:
    """A blurred image together with serializable level information."""

    image: Image.Image
    level: BlurLevel
    radius: float


def apply_gaussian_blur(source_image: Image.Image, level: BlurLevel) -> BlurApplication:
    """Apply one configured Gaussian Blur level without changing image size or mode."""
    if level not in BLUR_RADII:
        raise ValueError(f"Unsupported blur level: {level}")
    if source_image.width <= 0 or source_image.height <= 0:
        raise ValueError("source image must have positive dimensions")

    radius = BLUR_RADII[level]
    result = (
        source_image.copy()
        if radius == 0
        else source_image.filter(ImageFilter.GaussianBlur(radius=radius))
    )
    return BlurApplication(image=result, level=level, radius=radius)
