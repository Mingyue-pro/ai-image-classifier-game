from __future__ import annotations

import pytest
from PIL import Image

from backend.app.blur import BLUR_RADII, apply_gaussian_blur


def patterned_image(size: int = 96) -> Image.Image:
    image = Image.new("RGB", (size, size), "white")
    for y in range(size):
        for x in range(size):
            if (x // 8 + y // 8) % 2 == 0:
                image.putpixel((x, y), (15, 40, 210))
            else:
                image.putpixel((x, y), (240, 180, 20))
    return image


def pixel_difference(left: Image.Image, right: Image.Image) -> int:
    return sum(
        abs(before - after)
        for before, after in zip(left.tobytes(), right.tobytes(), strict=True)
    )


def test_none_keeps_every_pixel_identical() -> None:
    original = patterned_image()

    application = apply_gaussian_blur(original, "none")

    assert application.radius == 0
    assert application.image is not original
    assert application.image.mode == original.mode
    assert application.image.size == original.size
    assert application.image.tobytes() == original.tobytes()


def test_larger_blur_levels_change_the_image_more() -> None:
    original = patterned_image()
    low = apply_gaussian_blur(original, "low")
    medium = apply_gaussian_blur(original, "medium")
    high = apply_gaussian_blur(original, "high")

    assert BLUR_RADII == {"none": 0.0, "low": 4.0, "medium": 8.0, "high": 16.0}
    assert 0 < pixel_difference(original, low.image)
    assert pixel_difference(original, low.image) < pixel_difference(original, medium.image)
    assert pixel_difference(original, medium.image) < pixel_difference(original, high.image)


def test_blurred_image_remains_compatible_with_rgb_classifier_input() -> None:
    original = patterned_image()
    blurred = apply_gaussian_blur(original, "medium").image

    classifier_input = blurred.convert("RGB")

    assert classifier_input.mode == "RGB"
    assert classifier_input.size == original.size
    assert len(classifier_input.getbands()) == 3


def test_unknown_blur_level_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unsupported blur level"):
        apply_gaussian_blur(patterned_image(), "extreme")  # type: ignore[arg-type]
