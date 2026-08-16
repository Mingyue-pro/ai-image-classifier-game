from __future__ import annotations

from pathlib import Path

from PIL import Image

from backend.app.fgsm import create_delta_bundle, image_to_pixel_tensor, save_delta_bundle
from experiments.transfer_case_experiment import TransferExperimentConfig, build_transfer_image


def test_builds_one_repeatable_composite_without_running_a_sweep(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    patch_path = tmp_path / "patch.png"
    delta_path = tmp_path / "delta.pt"
    source = Image.new("RGB", (32, 32), (20, 80, 140))
    source.save(source_path)
    Image.new("RGBA", (8, 8), (230, 30, 10, 255)).save(patch_path)
    source_tensor = image_to_pixel_tensor(source)
    direction = source_tensor.new_ones(source_tensor.shape)
    save_delta_bundle(
        create_delta_bundle(source_tensor, direction, max_epsilon=4 / 255),
        delta_path,
    )
    config = TransferExperimentConfig(
        image_path=source_path.as_posix(),
        expected_human_class="test class",
        fgsm_delta_path=delta_path.as_posix(),
        pixel_strength=2,
        patch_enabled=True,
        patch_path=patch_path.as_posix(),
        patch_size=0.25,
        patch_position_x=0.5,
        patch_position_y=0.5,
        blur_level="low",
    )

    first = build_transfer_image(config)
    second = build_transfer_image(config)

    assert first.mode == "RGB"
    assert first.size == source.size
    assert first.tobytes() == second.tobytes()
    assert first.tobytes() != source.tobytes()
