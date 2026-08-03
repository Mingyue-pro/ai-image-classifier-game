"""Train and save a targeted adversarial patch for ResNet-34 candidate images."""

import argparse
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Any, Sequence

import torch
import torch.nn.functional as torch_functional
from PIL import Image, UnidentifiedImageError
from torch import nn
from torchvision.transforms import functional as vision_functional

from backend.app.image_manipulation import PatchParameters, apply_patch
from backend.app.model import MODEL_NAME, WEIGHTS, load_model
from scripts.generate_patch_case import display_path


@dataclass(frozen=True)
class PatchOptimizationParameters:
    """Configuration required to reproduce one patch-optimisation run."""

    target_class_index: int
    steps: int = 200
    learning_rate: float = 0.05
    patch_size_fraction: float = 0.3
    seed: int = 0

    def validate(self, class_count: int) -> None:
        if not 0 <= self.target_class_index < class_count:
            raise ValueError(
                f"target_class_index must be between 0 and {class_count - 1}"
            )
        if self.steps <= 0:
            raise ValueError("steps must be greater than 0")
        if self.learning_rate <= 0:
            raise ValueError("learning_rate must be greater than 0")
        if not 0.0 < self.patch_size_fraction <= 1.0:
            raise ValueError("patch_size_fraction must be greater than 0 and at most 1")


@dataclass(frozen=True)
class PatchOptimizationResult:
    """The trained patch and serializable facts about the optimisation run."""

    patch: torch.Tensor
    metadata: dict[str, Any]


def preprocess_image(image: Image.Image, crop_size: int, resize_size: int) -> torch.Tensor:
    """Match the official ResNet resize/crop while keeping pixels in the 0–1 range."""
    rgb_image = image.convert("RGB")
    resized = vision_functional.resize(
        rgb_image,
        resize_size,
        interpolation=vision_functional.InterpolationMode.BILINEAR,
        antialias=True,
    )
    cropped = vision_functional.center_crop(resized, [crop_size, crop_size])
    return vision_functional.pil_to_tensor(cropped).to(torch.float32) / 255.0


def apply_patch_tensor(
    image: torch.Tensor,
    patch: torch.Tensor,
    top: int,
    left: int,
) -> torch.Tensor:
    """Place a differentiable CHW patch inside a CHW image tensor."""
    if image.ndim != 3 or patch.ndim != 3:
        raise ValueError("image and patch must both be CHW tensors")
    if image.shape[0] != patch.shape[0]:
        raise ValueError("image and patch must have the same channel count")
    if top < 0 or left < 0:
        raise ValueError("top and left must not be negative")
    bottom = top + patch.shape[1]
    right = left + patch.shape[2]
    if bottom > image.shape[1] or right > image.shape[2]:
        raise ValueError("patch must fit inside the image")

    patched = image.clone()
    patched[:, top:bottom, left:right] = patch
    return patched


def optimize_patch(
    images: Sequence[torch.Tensor],
    model: nn.Module,
    parameters: PatchOptimizationParameters,
    mean: Sequence[float],
    std: Sequence[float],
) -> PatchOptimizationResult:
    """Optimise one universal patch to make all images predict a target class."""
    if not images:
        raise ValueError("at least one source image is required")
    first_shape = images[0].shape
    if len(first_shape) != 3 or first_shape[0] != 3:
        raise ValueError("source images must be RGB CHW tensors")
    if any(image.shape != first_shape for image in images):
        raise ValueError("all source image tensors must have the same shape")
    if len(mean) != 3 or len(std) != 3:
        raise ValueError("mean and std must contain three values")

    model.eval()
    with torch.inference_mode():
        class_count = int(model(images[0].unsqueeze(0)).shape[1])
    parameters.validate(class_count)

    original_requires_grad = [parameter.requires_grad for parameter in model.parameters()]
    model.requires_grad_(False)

    height, width = int(first_shape[1]), int(first_shape[2])
    patch_size = max(1, round(min(height, width) * parameters.patch_size_fraction))
    torch_generator = torch.Generator().manual_seed(parameters.seed)
    position_generator = random.Random(parameters.seed)
    patch = torch.rand(
        (3, patch_size, patch_size),
        generator=torch_generator,
        dtype=images[0].dtype,
        device=images[0].device,
        requires_grad=True,
    )
    optimizer = torch.optim.Adam([patch], lr=parameters.learning_rate)
    mean_tensor = torch.tensor(mean, dtype=patch.dtype, device=patch.device).view(1, 3, 1, 1)
    std_tensor = torch.tensor(std, dtype=patch.dtype, device=patch.device).view(1, 3, 1, 1)
    targets = torch.full(
        (len(images),),
        parameters.target_class_index,
        dtype=torch.long,
        device=patch.device,
    )
    losses: list[float] = []

    try:
        for _ in range(parameters.steps):
            patched_images = []
            for image in images:
                top = position_generator.randint(0, height - patch_size)
                left = position_generator.randint(0, width - patch_size)
                patched_images.append(apply_patch_tensor(image, patch, top, left))
            batch = torch.stack(patched_images)
            normalized_batch = (batch - mean_tensor) / std_tensor

            optimizer.zero_grad(set_to_none=True)
            logits = model(normalized_batch)
            loss = torch_functional.cross_entropy(logits, targets)
            loss.backward()
            optimizer.step()
            with torch.no_grad():
                patch.clamp_(0.0, 1.0)
            losses.append(float(loss.detach()))
    finally:
        for model_parameter, requires_grad in zip(
            model.parameters(), original_requires_grad, strict=True
        ):
            model_parameter.requires_grad_(requires_grad)

    return PatchOptimizationResult(
        patch=patch.detach(),
        metadata={
            "parameters": asdict(parameters),
            "source_image_count": len(images),
            "input_size": {"width": width, "height": height},
            "patch_size": {"width": patch_size, "height": patch_size},
            "training_coordinate_space": "resized_and_center_cropped_model_input",
            "initial_loss": losses[0],
            "final_loss": losses[-1],
        },
    )


def evaluate_patch_on_original_images(
    source_paths: Sequence[Path],
    patch: torch.Tensor,
    model: nn.Module,
    parameters: PatchOptimizationParameters,
    categories: Sequence[str],
    preprocess: Callable[[Image.Image], torch.Tensor] | None = None,
) -> dict[str, Any]:
    """Validate the patch through the real original-image composition pipeline."""
    patch_image = vision_functional.to_pil_image(patch.cpu())
    image_preprocess = preprocess if preprocess is not None else WEIGHTS.transforms()
    records: list[dict[str, Any]] = []

    model.eval()
    for source_path in source_paths:
        with Image.open(source_path) as source_image:
            source_image.load()
            baseline_batch = image_preprocess(source_image.convert("RGB")).unsqueeze(0)
            application = apply_patch(
                source_image,
                patch_image,
                PatchParameters(
                    position_x=0.5,
                    position_y=0.5,
                    size=parameters.patch_size_fraction,
                ),
            )
            patched_batch = image_preprocess(application.image).unsqueeze(0)

        with torch.inference_mode():
            baseline_probabilities = torch.softmax(model(baseline_batch)[0], dim=0)
            patched_probabilities = torch.softmax(model(patched_batch)[0], dim=0)
        baseline_index = int(baseline_probabilities.argmax())
        patched_index = int(patched_probabilities.argmax())
        target_probability = float(
            patched_probabilities[parameters.target_class_index]
        )
        target_rank = int(
            (patched_probabilities > target_probability).sum().item() + 1
        )
        records.append(
            {
                "source_path": display_path(source_path),
                "baseline_top1": {
                    "label": categories[baseline_index],
                    "probability": float(baseline_probabilities[baseline_index]),
                    "class_index": baseline_index,
                },
                "patched_top1": {
                    "label": categories[patched_index],
                    "probability": float(patched_probabilities[patched_index]),
                    "class_index": patched_index,
                },
                "classification_changed": patched_index != baseline_index,
                "target_probability": target_probability,
                "target_rank": target_rank,
                "targeted_top1_success": (
                    patched_index == parameters.target_class_index
                ),
            }
        )

    return {
        "placement": {
            "position_x": 0.5,
            "position_y": 0.5,
            "size_fraction": parameters.patch_size_fraction,
        },
        "targeted_top1_success_count": sum(
            record["targeted_top1_success"] for record in records
        ),
        "classification_changed_count": sum(
            record["classification_changed"] for record in records
        ),
        "image_count": len(records),
        "images": records,
    }


def load_source_images(
    source_paths: Sequence[Path], crop_size: int, resize_size: int
) -> list[torch.Tensor]:
    """Load candidate images and convert them to optimisation tensors."""
    images: list[torch.Tensor] = []
    for path in source_paths:
        if not path.is_file():
            raise ValueError(f"Source image does not exist: {path}")
        try:
            with Image.open(path) as image:
                image.load()
                images.append(preprocess_image(image, crop_size, resize_size))
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise ValueError(f"Could not read source image {path}: {error}") from error
    return images


def save_optimization_result(
    result: PatchOptimizationResult,
    output_patch_path: Path,
    metadata_path: Path,
    source_paths: Sequence[Path],
    target_label: str,
) -> dict[str, Any]:
    """Save the trained patch PNG and complete reproducibility metadata."""
    output_patch_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    vision_functional.to_pil_image(result.patch.cpu()).save(
        output_patch_path, format="PNG"
    )
    metadata = {
        "schema_version": "1.0",
        "manipulation_type": "targeted_adversarial_patch_optimization",
        "model_name": MODEL_NAME,
        "weights_name": WEIGHTS.name,
        "target_label": target_label,
        "source_paths": [display_path(path) for path in source_paths],
        "output_patch_path": display_path(output_patch_path),
        **result.metadata,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return metadata


def resolve_target_class(target_label: str, categories: Sequence[str]) -> int:
    """Resolve a case-insensitive exact ImageNet label to its class index."""
    matches = [
        index
        for index, category in enumerate(categories)
        if category.casefold() == target_label.casefold()
    ]
    if not matches:
        raise ValueError(f"Unknown ImageNet target label: {target_label}")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_images", nargs="+", type=Path)
    parser.add_argument("--target-label", required=True)
    parser.add_argument("--output-patch", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--patch-size", type=float, default=0.3)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    try:
        transforms = WEIGHTS.transforms()
        crop_size = int(transforms.crop_size[0])
        resize_size = int(transforms.resize_size[0])
        categories = WEIGHTS.meta["categories"]
        target_class_index = resolve_target_class(args.target_label, categories)
        images = load_source_images(args.source_images, crop_size, resize_size)
        parameters = PatchOptimizationParameters(
            target_class_index=target_class_index,
            steps=args.steps,
            learning_rate=args.learning_rate,
            patch_size_fraction=args.patch_size,
            seed=args.seed,
        )
        model = load_model()
        result = optimize_patch(
            images=images,
            model=model,
            parameters=parameters,
            mean=transforms.mean,
            std=transforms.std,
        )
        validation = evaluate_patch_on_original_images(
            args.source_images,
            result.patch,
            model,
            parameters,
            categories,
        )
        result = PatchOptimizationResult(
            patch=result.patch,
            metadata={**result.metadata, "original_image_validation": validation},
        )
        metadata = save_optimization_result(
            result,
            args.output_patch,
            args.metadata,
            args.source_images,
            categories[target_class_index],
        )
    except (OSError, ValueError) as error:
        parser.error(str(error))

    print(
        f"Saved targeted adversarial patch to {metadata['output_patch_path']} "
        f"(target={metadata['target_label']}, "
        f"loss={metadata['initial_loss']:.4f}->{metadata['final_loss']:.4f}, "
        "targeted_top1_successes="
        f"{metadata['original_image_validation']['targeted_top1_success_count']}/"
        f"{metadata['original_image_validation']['image_count']})"
    )


if __name__ == "__main__":
    main()
