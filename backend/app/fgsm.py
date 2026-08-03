"""Reusable Fast Gradient Sign Method helpers for offline and runtime cases."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import torch
import torch.nn.functional as torch_functional
from PIL import Image
from torch import nn
from torchvision.transforms import functional as vision_functional


@dataclass(frozen=True)
class FgsmDirectionResult:
    """A signed pixel direction and the loss used to generate it."""

    direction: torch.Tensor
    loss: float


@dataclass(frozen=True)
class FgsmDeltaBundle:
    """Saved tensors needed to reconstruct adjustable FGSM states."""

    direction: torch.Tensor
    max_delta: torch.Tensor
    max_epsilon: float


def preprocess_pixel_tensor(
    image: Image.Image,
    crop_size: int,
    resize_size: int,
) -> torch.Tensor:
    """Apply official model geometry while retaining pixels in the 0–1 range."""
    rgb_image = image.convert("RGB")
    resized = vision_functional.resize(
        rgb_image,
        resize_size,
        interpolation=vision_functional.InterpolationMode.BILINEAR,
        antialias=True,
    )
    cropped = vision_functional.center_crop(resized, [crop_size, crop_size])
    return vision_functional.pil_to_tensor(cropped).to(torch.float32) / 255.0


def image_to_pixel_tensor(image: Image.Image) -> torch.Tensor:
    """Convert an RGB image to its original-size 0–1 CHW pixel tensor."""
    return (
        vision_functional.pil_to_tensor(image.convert("RGB")).to(torch.float32)
        / 255.0
    )


def normalize_batch(
    batch: torch.Tensor,
    mean: Sequence[float],
    std: Sequence[float],
) -> torch.Tensor:
    """Normalize an NCHW batch using the model weight statistics."""
    if batch.ndim != 4 or batch.shape[1] != 3:
        raise ValueError("batch must be an NCHW RGB tensor")
    if len(mean) != 3 or len(std) != 3:
        raise ValueError("mean and std must contain three values")
    mean_tensor = torch.tensor(mean, dtype=batch.dtype, device=batch.device).view(
        1, 3, 1, 1
    )
    std_tensor = torch.tensor(std, dtype=batch.dtype, device=batch.device).view(
        1, 3, 1, 1
    )
    if torch.any(std_tensor <= 0):
        raise ValueError("std values must be greater than 0")
    return (batch - mean_tensor) / std_tensor


def generate_fgsm_direction(
    image: torch.Tensor,
    model: nn.Module,
    true_class_index: int,
    mean: Sequence[float],
    std: Sequence[float],
    preprocess: Callable[[torch.Tensor], torch.Tensor] | None = None,
) -> FgsmDirectionResult:
    """Find the per-pixel direction that increases true-class loss."""
    if image.ndim != 3 or image.shape[0] != 3:
        raise ValueError("image must be a CHW RGB tensor")
    if torch.any((image < 0.0) | (image > 1.0)):
        raise ValueError("image pixels must be between 0 and 1")

    was_training = model.training
    model.eval()
    original_requires_grad = [parameter.requires_grad for parameter in model.parameters()]
    model.requires_grad_(False)
    differentiable_image = image.detach().clone().requires_grad_(True)

    try:
        if preprocess is None:
            model_input = normalize_batch(
                differentiable_image.unsqueeze(0), mean, std
            )
        else:
            model_input = preprocess(differentiable_image).unsqueeze(0)
        logits = model(model_input)
        if logits.ndim != 2 or logits.shape[0] != 1:
            raise ValueError("model must return one row of class logits")
        class_count = int(logits.shape[1])
        if not 0 <= true_class_index < class_count:
            raise ValueError(
                f"true_class_index must be between 0 and {class_count - 1}"
            )
        target = torch.tensor([true_class_index], device=logits.device)
        loss = torch_functional.cross_entropy(logits, target)
        loss.backward()
        if differentiable_image.grad is None:
            raise RuntimeError("model did not produce an input gradient")
        direction = differentiable_image.grad.sign().detach()
    finally:
        for model_parameter, requires_grad in zip(
            model.parameters(), original_requires_grad, strict=True
        ):
            model_parameter.requires_grad_(requires_grad)
        model.train(was_training)

    return FgsmDirectionResult(direction=direction, loss=float(loss.detach()))


def apply_fgsm(
    image: torch.Tensor,
    direction: torch.Tensor,
    epsilon: float,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Apply an FGSM direction and return the image plus its actual clipped delta."""
    if image.shape != direction.shape:
        raise ValueError("image and direction must have the same shape")
    if image.ndim != 3 or image.shape[0] != 3:
        raise ValueError("image and direction must be CHW RGB tensors")
    if not 0.0 <= epsilon <= 1.0:
        raise ValueError("epsilon must be between 0 and 1")
    adversarial = torch.clamp(image + epsilon * direction, 0.0, 1.0)
    return adversarial, adversarial - image


def predict_top5(
    image: torch.Tensor,
    model: nn.Module,
    mean: Sequence[float],
    std: Sequence[float],
    categories: Sequence[str],
    preprocess: Callable[[torch.Tensor], torch.Tensor] | None = None,
) -> list[dict[str, Any]]:
    """Classify one 0–1 CHW tensor and return serializable Top-5 records."""
    if preprocess is None:
        model_input = normalize_batch(image.unsqueeze(0), mean, std)[0]
    else:
        model_input = preprocess(image)
    return predict_model_input_top5(model_input, model, categories)


def predict_model_input_top5(
    model_input: torch.Tensor,
    model: nn.Module,
    categories: Sequence[str],
) -> list[dict[str, Any]]:
    """Classify one already-preprocessed CHW model input."""
    if model_input.ndim != 3 or model_input.shape[0] != 3:
        raise ValueError("model_input must be a CHW RGB tensor")
    was_training = model.training
    model.eval()
    try:
        with torch.inference_mode():
            probabilities = torch.softmax(model(model_input.unsqueeze(0))[0], dim=0)
    finally:
        model.train(was_training)
    if len(categories) != probabilities.numel():
        raise ValueError("categories must match the model class count")
    count = min(5, probabilities.numel())
    top_probabilities, top_indices = probabilities.topk(count)
    return [
        {
            "label": categories[class_index],
            "probability": float(probability),
            "class_index": class_index,
        }
        for probability, class_index in zip(
            top_probabilities.tolist(), top_indices.tolist(), strict=True
        )
    ]


def create_delta_bundle(
    image: torch.Tensor,
    direction: torch.Tensor,
    max_epsilon: float,
) -> FgsmDeltaBundle:
    """Create the saved direction and maximum clipped delta for a case."""
    _, max_delta = apply_fgsm(image, direction, max_epsilon)
    return FgsmDeltaBundle(
        direction=direction.detach().cpu(),
        max_delta=max_delta.detach().cpu(),
        max_epsilon=max_epsilon,
    )


def save_delta_bundle(bundle: FgsmDeltaBundle, output_path: Path) -> None:
    """Save a tensor-only bundle that can be loaded with weights_only safety."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "direction": bundle.direction.cpu(),
            "max_delta": bundle.max_delta.cpu(),
            "max_epsilon": bundle.max_epsilon,
        },
        output_path,
    )


def load_delta_bundle(input_path: Path) -> FgsmDeltaBundle:
    """Load and validate a locally generated FGSM tensor bundle."""
    if not input_path.is_file():
        raise ValueError(f"Delta bundle does not exist: {input_path}")
    payload = torch.load(input_path, map_location="cpu", weights_only=True)
    if not isinstance(payload, dict):
        raise ValueError("delta bundle must contain a dictionary")
    required = {"direction", "max_delta", "max_epsilon"}
    if set(payload) != required:
        raise ValueError("delta bundle has unexpected fields")
    direction = payload["direction"]
    max_delta = payload["max_delta"]
    max_epsilon = payload["max_epsilon"]
    if not isinstance(direction, torch.Tensor) or not isinstance(
        max_delta, torch.Tensor
    ):
        raise ValueError("delta bundle tensors are invalid")
    if direction.shape != max_delta.shape:
        raise ValueError("direction and max_delta shapes must match")
    if direction.ndim != 3 or direction.shape[0] != 3:
        raise ValueError("delta bundle tensors must be CHW RGB tensors")
    if not direction.is_floating_point() or not max_delta.is_floating_point():
        raise ValueError("delta bundle tensors must use floating-point values")
    if not torch.isfinite(direction).all() or not torch.isfinite(max_delta).all():
        raise ValueError("delta bundle tensors must contain finite values")
    if not torch.all((direction == -1) | (direction == 0) | (direction == 1)):
        raise ValueError("direction values must be -1, 0, or 1")
    if not isinstance(max_epsilon, (int, float)):
        raise ValueError("max_epsilon must be numeric")
    if not 0.0 <= float(max_epsilon) <= 1.0:
        raise ValueError("max_epsilon must be between 0 and 1")
    if torch.any(max_delta.abs() > float(max_epsilon) + 1e-7):
        raise ValueError("max_delta exceeds max_epsilon")
    if torch.any(max_delta * direction < -1e-7):
        raise ValueError("max_delta direction is inconsistent")
    if torch.any((direction == 0) & (max_delta.abs() > 1e-7)):
        raise ValueError("max_delta must be zero where direction is zero")
    return FgsmDeltaBundle(
        direction=direction,
        max_delta=max_delta,
        max_epsilon=float(max_epsilon),
    )


def reconstruct_fgsm_state(
    image: torch.Tensor,
    bundle: FgsmDeltaBundle,
    epsilon: float,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Rebuild an adjustable state from the saved direction and original pixels."""
    if epsilon > bundle.max_epsilon:
        raise ValueError("epsilon must not exceed the bundle max_epsilon")
    return apply_fgsm(image, bundle.direction.to(image.device), epsilon)
