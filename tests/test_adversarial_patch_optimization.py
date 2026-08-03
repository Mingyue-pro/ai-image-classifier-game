import json
from pathlib import Path

import pytest
import torch
from PIL import Image
from torch import nn

from scripts.optimize_adversarial_patch import (
    PatchOptimizationParameters,
    PatchOptimizationResult,
    apply_patch_tensor,
    evaluate_patch_on_original_images,
    optimize_patch,
    preprocess_image,
    resolve_target_class,
    save_optimization_result,
)


class MeanColourClassifier(nn.Module):
    """Small differentiable model used instead of downloading ResNet in tests."""

    def forward(self, batch: torch.Tensor) -> torch.Tensor:
        red_mean = batch[:, 0].mean(dim=(1, 2))
        return torch.stack((-red_mean, red_mean), dim=1)


def test_preprocess_image_resizes_and_center_crops() -> None:
    image = Image.new("RGB", (20, 10), color=(255, 0, 0))

    tensor = preprocess_image(image, crop_size=8, resize_size=10)

    assert tensor.shape == (3, 8, 8)
    assert torch.allclose(tensor[0], torch.ones((8, 8)))
    assert torch.count_nonzero(tensor[1:]) == 0


def test_apply_patch_tensor_keeps_gradient_flow() -> None:
    image = torch.zeros((3, 6, 6))
    patch = torch.ones((3, 2, 2), requires_grad=True)

    output = apply_patch_tensor(image, patch, top=1, left=3)
    output.sum().backward()

    assert torch.equal(output[:, 1:3, 3:5], patch)
    assert torch.equal(patch.grad, torch.ones_like(patch))


def test_optimize_patch_updates_pixels_towards_target_class() -> None:
    images = [torch.zeros((3, 8, 8)), torch.zeros((3, 8, 8))]

    result = optimize_patch(
        images,
        MeanColourClassifier(),
        PatchOptimizationParameters(
            target_class_index=1,
            steps=20,
            learning_rate=0.1,
            patch_size_fraction=0.5,
            seed=4,
        ),
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
    )

    assert result.patch.shape == (3, 4, 4)
    assert result.patch[0].mean() > 0.9
    assert torch.all((0.0 <= result.patch) & (result.patch <= 1.0))
    assert result.metadata["final_loss"] < result.metadata["initial_loss"]


def test_optimize_patch_restores_model_parameter_gradient_settings() -> None:
    model = nn.Sequential(nn.Flatten(), nn.Linear(3 * 8 * 8, 2))
    model[1].weight.requires_grad_(False)
    original_settings = [parameter.requires_grad for parameter in model.parameters()]

    optimize_patch(
        [torch.zeros((3, 8, 8))],
        model,
        PatchOptimizationParameters(target_class_index=1, steps=1),
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
    )

    assert [parameter.requires_grad for parameter in model.parameters()] == original_settings


@pytest.mark.parametrize(
    "parameters",
    [
        PatchOptimizationParameters(target_class_index=-1),
        PatchOptimizationParameters(target_class_index=2),
        PatchOptimizationParameters(target_class_index=1, steps=0),
        PatchOptimizationParameters(target_class_index=1, learning_rate=0.0),
        PatchOptimizationParameters(target_class_index=1, patch_size_fraction=0.0),
    ],
)
def test_optimize_patch_rejects_invalid_parameters(
    parameters: PatchOptimizationParameters,
) -> None:
    with pytest.raises(ValueError):
        optimize_patch(
            [torch.zeros((3, 8, 8))],
            MeanColourClassifier(),
            parameters,
            mean=(0.0, 0.0, 0.0),
            std=(1.0, 1.0, 1.0),
        )


def test_save_optimization_result_writes_png_and_metadata(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    source_path.write_bytes(b"source placeholder")
    output_path = tmp_path / "patches" / "patch.png"
    metadata_path = tmp_path / "results" / "patch.json"
    result = PatchOptimizationResult(
        patch=torch.full((3, 4, 4), 0.5),
        metadata={"initial_loss": 2.0, "final_loss": 0.5},
    )

    metadata = save_optimization_result(
        result,
        output_path,
        metadata_path,
        [source_path],
        "toaster",
    )

    with Image.open(output_path) as patch_image:
        assert patch_image.format == "PNG"
        assert patch_image.size == (4, 4)
    assert json.loads(metadata_path.read_text(encoding="utf-8")) == metadata
    assert metadata["target_label"] == "toaster"


def test_evaluate_patch_uses_original_image_application_pipeline(
    tmp_path: Path,
) -> None:
    source_path = tmp_path / "source.png"
    Image.new("RGB", (12, 8), color="black").save(source_path)

    validation = evaluate_patch_on_original_images(
        [source_path],
        torch.ones((3, 4, 4)),
        MeanColourClassifier(),
        PatchOptimizationParameters(
            target_class_index=1,
            steps=1,
            patch_size_fraction=0.5,
        ),
        categories=["dark", "red"],
        preprocess=lambda image: vision_tensor(image, (8, 8)),
    )

    assert validation["classification_changed_count"] == 1
    assert validation["targeted_top1_success_count"] == 1
    assert validation["images"][0]["baseline_top1"]["label"] == "dark"
    assert validation["images"][0]["patched_top1"]["label"] == "red"


def vision_tensor(image: Image.Image, size: tuple[int, int]) -> torch.Tensor:
    resized = image.resize(size)
    values = torch.frombuffer(bytearray(resized.tobytes()), dtype=torch.uint8).to(
        torch.float32
    )
    return values.reshape(size[1], size[0], 3).permute(2, 0, 1) / 255.0


def test_resolve_target_class_is_case_insensitive() -> None:
    assert resolve_target_class("TOASTER", ["banana", "toaster"]) == 1
    with pytest.raises(ValueError, match="Unknown ImageNet target label"):
        resolve_target_class("missing", ["banana", "toaster"])
