import json
from pathlib import Path

import pytest
import torch
from PIL import Image
from torch import nn

from backend.app.fgsm import (
    apply_fgsm,
    create_delta_bundle,
    generate_fgsm_direction,
    load_delta_bundle,
    normalize_batch,
    predict_top5,
    preprocess_pixel_tensor,
    reconstruct_fgsm_state,
    save_delta_bundle,
)
from scripts.generate_fgsm_cases import (
    epsilon_filename,
    generate_fgsm_case_set,
    resolve_class_index,
    validate_epsilons,
)


class MeanBrightnessClassifier(nn.Module):
    """Small differentiable classifier used instead of ResNet in tests."""

    def forward(self, batch: torch.Tensor) -> torch.Tensor:
        brightness = batch.mean(dim=(1, 2, 3))
        return torch.stack((-brightness, brightness), dim=1)


def identity_image_preprocess(image: Image.Image | torch.Tensor) -> torch.Tensor:
    if isinstance(image, Image.Image):
        values = torch.frombuffer(
            bytearray(image.convert("RGB").tobytes()), dtype=torch.uint8
        ).to(torch.float32)
        return values.reshape(image.height, image.width, 3).permute(2, 0, 1) / 255.0
    return image


def test_preprocess_pixel_tensor_resizes_and_center_crops() -> None:
    image = Image.new("RGB", (20, 10), color=(255, 0, 0))

    tensor = preprocess_pixel_tensor(image, crop_size=8, resize_size=10)

    assert tensor.shape == (3, 8, 8)
    assert torch.allclose(tensor[0], torch.ones((8, 8)))
    assert torch.count_nonzero(tensor[1:]) == 0


def test_normalize_batch_uses_channel_statistics() -> None:
    batch = torch.tensor([[[[0.5]], [[0.4]], [[0.3]]]])

    normalized = normalize_batch(batch, mean=(0.1, 0.2, 0.3), std=(0.2, 0.1, 0.5))

    assert torch.allclose(normalized.flatten(), torch.tensor([2.0, 2.0, 0.0]))


def test_predict_top5_accepts_preprocess_and_restores_model_state() -> None:
    model = MeanBrightnessClassifier()
    model.train()

    top5 = predict_top5(
        torch.zeros((3, 4, 4)),
        model,
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
        categories=["dark", "bright"],
        preprocess=lambda image: image,
    )

    assert top5[0]["label"] == "dark"
    assert model.training is True


def test_generate_direction_increases_true_class_loss() -> None:
    model = MeanBrightnessClassifier()
    image = torch.zeros((3, 4, 4))

    result = generate_fgsm_direction(
        image,
        model,
        true_class_index=0,
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
    )

    assert torch.equal(result.direction, torch.ones_like(image))
    adversarial, _ = apply_fgsm(image, result.direction, epsilon=1.0)
    assert model(adversarial.unsqueeze(0)).argmax(dim=1).item() == 1


def test_generate_direction_restores_model_gradient_settings() -> None:
    model = nn.Sequential(nn.Flatten(), nn.Linear(3 * 4 * 4, 2))
    model[1].weight.requires_grad_(False)
    original_settings = [parameter.requires_grad for parameter in model.parameters()]
    model.train()

    generate_fgsm_direction(
        torch.zeros((3, 4, 4)),
        model,
        true_class_index=0,
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
    )

    assert [parameter.requires_grad for parameter in model.parameters()] == original_settings
    assert model.training is True


def test_apply_fgsm_clips_pixels_and_returns_actual_delta() -> None:
    image = torch.tensor([[[0.95]], [[0.05]], [[0.50]]])
    direction = torch.tensor([[[1.0]], [[-1.0]], [[1.0]]])

    adversarial, delta = apply_fgsm(image, direction, epsilon=0.1)

    assert torch.allclose(adversarial.flatten(), torch.tensor([1.0, 0.0, 0.6]))
    assert torch.allclose(delta.flatten(), torch.tensor([0.05, -0.05, 0.1]))


def test_delta_bundle_round_trip_reconstructs_maximum_state(tmp_path: Path) -> None:
    image = torch.full((3, 2, 2), 0.5)
    direction = torch.tensor(
        [
            [[1.0, -1.0], [1.0, -1.0]],
            [[1.0, -1.0], [1.0, -1.0]],
            [[1.0, -1.0], [1.0, -1.0]],
        ]
    )
    path = tmp_path / "delta.pt"

    save_delta_bundle(create_delta_bundle(image, direction, 4 / 255), path)
    loaded = load_delta_bundle(path)
    expected, _ = apply_fgsm(image, direction, 4 / 255)

    assert torch.equal(loaded.direction, direction)
    assert torch.allclose(torch.clamp(image + loaded.max_delta, 0, 1), expected)
    assert loaded.max_epsilon == 4 / 255
    reconstructed, _ = reconstruct_fgsm_state(image, loaded, 2 / 255)
    direct, _ = apply_fgsm(image, direction, 2 / 255)
    assert torch.allclose(reconstructed, direct)


def test_load_delta_bundle_rejects_invalid_direction(tmp_path: Path) -> None:
    path = tmp_path / "invalid.pt"
    torch.save(
        {
            "direction": torch.full((3, 2, 2), 0.5),
            "max_delta": torch.zeros((3, 2, 2)),
            "max_epsilon": 4 / 255,
        },
        path,
    )

    with pytest.raises(ValueError, match="direction values"):
        load_delta_bundle(path)


@pytest.mark.parametrize("epsilon", [-0.1, 1.1])
def test_apply_fgsm_rejects_invalid_epsilon(epsilon: float) -> None:
    with pytest.raises(ValueError, match="epsilon must be between 0 and 1"):
        apply_fgsm(torch.zeros((3, 2, 2)), torch.ones((3, 2, 2)), epsilon)


def test_generate_case_set_saves_images_delta_and_metadata(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    Image.new("RGB", (8, 8), color="black").save(source_path)
    output_directory = tmp_path / "generated"
    delta_path = tmp_path / "perturbations" / "delta.pt"
    metadata_path = tmp_path / "results" / "case.json"

    metadata = generate_fgsm_case_set(
        source_path=source_path,
        true_class_index=0,
        epsilons=[0.0, 1.0],
        output_directory=output_directory,
        delta_path=delta_path,
        metadata_path=metadata_path,
        model=MeanBrightnessClassifier(),
        categories=["dark", "bright"],
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
        crop_size=8,
        resize_size=8,
        model_preprocess=identity_image_preprocess,
    )

    assert delta_path.is_file()
    assert (output_directory / "epsilon-000.png").is_file()
    assert (output_directory / "epsilon-255.png").is_file()
    assert json.loads(metadata_path.read_text(encoding="utf-8")) == metadata
    assert metadata["baseline_top1"]["label"] == "dark"
    assert metadata["cases"][0]["true_class_is_top1"] is True
    assert metadata["cases"][0]["saved_changed_value_count"] == 0
    assert metadata["cases"][1]["top1"]["label"] == "bright"
    assert metadata["cases"][1]["classification_changed"] is True
    assert metadata["pixel_coordinate_space"] == (
        "original_image_before_model_preprocessing"
    )
    assert len(metadata["source_sha256"]) == 64


def test_epsilon_and_label_validation() -> None:
    assert validate_epsilons([4 / 255, 0.0, 4 / 255]) == [0.0, 4 / 255]
    assert epsilon_filename(4 / 255) == "epsilon-004.png"
    assert resolve_class_index("BANANA", ["apple", "banana"]) == 1
    with pytest.raises(ValueError, match="at least one epsilon"):
        validate_epsilons([])
    with pytest.raises(ValueError, match="Unknown ImageNet label"):
        resolve_class_index("missing", ["apple", "banana"])
