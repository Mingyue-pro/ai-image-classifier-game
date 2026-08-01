"""Reusable image manipulation functions for offline and runtime cases."""

from dataclasses import dataclass
from typing import Any

from PIL import Image


@dataclass(frozen=True)
class PatchParameters:
    """Normalized controls for placing a square patch inside an image."""

    position_x: float
    position_y: float
    size: float

    def validate(self) -> None:
        for name, value in (
            ("position_x", self.position_x),
            ("position_y", self.position_y),
        ):
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be between 0 and 1")
        if not 0.0 < self.size <= 1.0:
            raise ValueError("size must be greater than 0 and at most 1")


@dataclass(frozen=True)
class PatchApplication:
    """A composed image together with serializable placement metadata."""

    image: Image.Image
    metadata: dict[str, Any]


def apply_patch(
    source_image: Image.Image,
    patch_image: Image.Image,
    parameters: PatchParameters,
) -> PatchApplication:
    """Resize and place a square patch without moving outside the source image."""
    parameters.validate()
    if source_image.width <= 0 or source_image.height <= 0:
        raise ValueError("source image must have positive dimensions")
    if patch_image.width <= 0 or patch_image.height <= 0:
        raise ValueError("patch image must have positive dimensions")

    source = source_image.convert("RGB")
    patch_size = max(
        1,
        round(min(source.width, source.height) * parameters.size),
    )
    available_x = source.width - patch_size
    available_y = source.height - patch_size
    left = round(available_x * parameters.position_x)
    top = round(available_y * parameters.position_y)
    box = (left, top, left + patch_size, top + patch_size)

    resized_patch = patch_image.convert("RGBA").resize(
        (patch_size, patch_size),
        Image.Resampling.LANCZOS,
    )
    composed = source.copy()
    composed.paste(resized_patch, box[:2], resized_patch)

    return PatchApplication(
        image=composed,
        metadata={
            "position": {
                "x": parameters.position_x,
                "y": parameters.position_y,
            },
            "size_fraction": parameters.size,
            "source_size": {
                "width": source.width,
                "height": source.height,
            },
            "patch_size": {
                "width": patch_size,
                "height": patch_size,
            },
            "pixel_box": {
                "left": box[0],
                "top": box[1],
                "right": box[2],
                "bottom": box[3],
            },
        },
    )
