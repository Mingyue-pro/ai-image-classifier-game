import json
from pathlib import Path

import pytest
from PIL import Image

from backend.app.image_manipulation import PatchParameters, apply_patch
from scripts.generate_patch_case import generate_patch_case


def test_apply_patch_uses_normalized_position_and_size() -> None:
    source = Image.new("RGB", (10, 8), color="blue")
    patch = Image.new("RGB", (3, 5), color="red")

    application = apply_patch(
        source,
        patch,
        PatchParameters(position_x=1.0, position_y=0.0, size=0.5),
    )

    assert application.image.size == (10, 8)
    assert application.image.getpixel((6, 0)) == (255, 0, 0)
    assert application.image.getpixel((9, 3)) == (255, 0, 0)
    assert application.image.getpixel((5, 0)) == (0, 0, 255)
    assert application.metadata["patch_size"] == {"width": 4, "height": 4}
    assert application.metadata["pixel_box"] == {
        "left": 6,
        "top": 0,
        "right": 10,
        "bottom": 4,
    }


def test_apply_patch_supports_transparency() -> None:
    source = Image.new("RGB", (4, 4), color=(0, 0, 255))
    patch = Image.new("RGBA", (2, 2), color=(255, 0, 0, 0))

    application = apply_patch(
        source,
        patch,
        PatchParameters(position_x=0.0, position_y=0.0, size=0.5),
    )

    assert application.image.getpixel((0, 0)) == (0, 0, 255)


@pytest.mark.parametrize(
    "parameters",
    [
        PatchParameters(position_x=-0.1, position_y=0.0, size=0.2),
        PatchParameters(position_x=0.0, position_y=1.1, size=0.2),
        PatchParameters(position_x=0.0, position_y=0.0, size=0.0),
        PatchParameters(position_x=0.0, position_y=0.0, size=1.1),
    ],
)
def test_apply_patch_rejects_invalid_parameters(
    parameters: PatchParameters,
) -> None:
    with pytest.raises(ValueError):
        apply_patch(
            Image.new("RGB", (8, 8)),
            Image.new("RGB", (2, 2)),
            parameters,
        )


def test_generate_patch_case_saves_image_and_metadata(tmp_path: Path) -> None:
    source_path = tmp_path / "source.jpg"
    patch_path = tmp_path / "patch.png"
    output_path = tmp_path / "generated" / "case.png"
    metadata_path = tmp_path / "results" / "case.json"
    Image.new("RGB", (12, 8), color="blue").save(source_path)
    Image.new("RGB", (4, 4), color="red").save(patch_path)

    metadata = generate_patch_case(
        source_path,
        patch_path,
        output_path,
        metadata_path,
        PatchParameters(position_x=0.5, position_y=1.0, size=0.25),
    )

    assert output_path.is_file()
    with Image.open(output_path) as output_image:
        assert output_image.format == "PNG"
        assert output_image.size == (12, 8)
    assert json.loads(metadata_path.read_text(encoding="utf-8")) == metadata
    assert metadata["manipulation_type"] == "adversarial_patch"
    assert metadata["patch_size"] == {"width": 2, "height": 2}
