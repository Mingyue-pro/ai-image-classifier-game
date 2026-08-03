"""Generate reproducible FGSM epsilon states, delta tensors, and metadata."""

import argparse
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, Sequence

import torch
from PIL import Image, UnidentifiedImageError
from torch import nn
from torchvision.transforms import functional as vision_functional

from backend.app.fgsm import (
    apply_fgsm,
    create_delta_bundle,
    generate_fgsm_direction,
    image_to_pixel_tensor,
    predict_model_input_top5,
    predict_top5,
    save_delta_bundle,
)
from backend.app.model import MODEL_NAME, WEIGHTS, load_model


def display_path(path: Path) -> str:
    """Return a project-relative path when possible."""
    resolved_path = path.resolve()
    try:
        return resolved_path.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return resolved_path.as_posix()


def resolve_class_index(label: str, categories: Sequence[str]) -> int:
    """Resolve a case-insensitive exact ImageNet label."""
    matches = [
        index
        for index, category in enumerate(categories)
        if category.casefold() == label.casefold()
    ]
    if not matches:
        raise ValueError(f"Unknown ImageNet label: {label}")
    return matches[0]


def validate_epsilons(epsilons: Sequence[float]) -> list[float]:
    """Return sorted unique epsilon values in the 0–1 pixel range."""
    if not epsilons:
        raise ValueError("at least one epsilon is required")
    if any(not 0.0 <= epsilon <= 1.0 for epsilon in epsilons):
        raise ValueError("epsilon values must be between 0 and 1")
    return sorted(set(float(epsilon) for epsilon in epsilons))


def epsilon_filename(epsilon: float) -> str:
    """Create a stable filename from an epsilon expressed in 0–1 pixels."""
    pixel_units = epsilon * 255.0
    label = f"{pixel_units:.3f}".rstrip("0").rstrip(".").replace(".", "p")
    return f"epsilon-{label.zfill(3)}.png"


def generate_fgsm_case_set(
    source_path: Path,
    true_class_index: int,
    epsilons: Sequence[float],
    output_directory: Path,
    delta_path: Path,
    metadata_path: Path,
    model: nn.Module,
    categories: Sequence[str],
    mean: Sequence[float],
    std: Sequence[float],
    crop_size: int,
    resize_size: int,
    model_preprocess: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    """Generate and classify all requested epsilon states for one source image."""
    if not source_path.is_file():
        raise ValueError(f"Source image does not exist: {source_path}")
    checked_epsilons = validate_epsilons(epsilons)
    if not 0 <= true_class_index < len(categories):
        raise ValueError(
            f"true_class_index must be between 0 and {len(categories) - 1}"
        )

    try:
        with Image.open(source_path) as source_image:
            source_image.load()
            source_information = {
                "format": source_image.format,
                "width": source_image.width,
                "height": source_image.height,
                "mode": source_image.mode,
            }
            pixel_image = image_to_pixel_tensor(source_image)
            baseline_model_input = (
                model_preprocess(source_image.convert("RGB"))
                if model_preprocess is not None
                else None
            )
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError(f"Could not read source image {source_path}: {error}") from error

    direction_result = generate_fgsm_direction(
        pixel_image,
        model,
        true_class_index=true_class_index,
        mean=mean,
        std=std,
        preprocess=model_preprocess,
    )
    max_epsilon = max(checked_epsilons)
    save_delta_bundle(
        create_delta_bundle(pixel_image, direction_result.direction, max_epsilon),
        delta_path,
    )
    output_directory.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)

    if baseline_model_input is None:
        baseline_top5 = predict_top5(pixel_image, model, mean, std, categories)
    else:
        baseline_top5 = predict_model_input_top5(
            baseline_model_input, model, categories
        )
    cases: list[dict[str, Any]] = []
    for epsilon in checked_epsilons:
        adversarial_image, actual_delta = apply_fgsm(
            pixel_image, direction_result.direction, epsilon
        )
        output_path = output_directory / epsilon_filename(epsilon)
        vision_functional.to_pil_image(adversarial_image.cpu()).save(
            output_path, format="PNG"
        )
        with Image.open(output_path) as saved_image:
            saved_image.load()
            reloaded_adversarial = image_to_pixel_tensor(saved_image)
            saved_model_input = (
                model_preprocess(saved_image.convert("RGB"))
                if model_preprocess is not None
                else None
            )
        saved_delta = reloaded_adversarial - pixel_image
        if saved_model_input is None:
            top5 = predict_top5(
                reloaded_adversarial, model, mean, std, categories
            )
        else:
            top5 = predict_model_input_top5(saved_model_input, model, categories)
        top1 = top5[0]
        cases.append(
            {
                "epsilon": epsilon,
                "epsilon_pixels": epsilon * 255.0,
                "output_image_path": display_path(output_path),
                "top1": top1,
                "top5": top5,
                "classification_changed": (
                    top1["class_index"] != baseline_top5[0]["class_index"]
                ),
                "true_class_is_top1": top1["class_index"] == true_class_index,
                "actual_delta_min": float(actual_delta.min()),
                "actual_delta_max": float(actual_delta.max()),
                "saved_delta_min": float(saved_delta.min()),
                "saved_delta_max": float(saved_delta.max()),
                "saved_changed_value_count": int(torch.count_nonzero(saved_delta)),
            }
        )

    metadata = {
        "schema_version": "1.0",
        "manipulation_type": "untargeted_fgsm",
        "model_name": MODEL_NAME,
        "weights_name": WEIGHTS.name,
        "source_path": display_path(source_path),
        "source_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "source_image": source_information,
        "model_input_size": {"width": crop_size, "height": crop_size},
        "pixel_coordinate_space": "original_image_before_model_preprocessing",
        "preprocessing": {
            "resize_size": resize_size,
            "crop_size": crop_size,
            "interpolation": "bilinear",
            "antialias": True,
            "normalization_mean": list(mean),
            "normalization_std": list(std),
        },
        "true_class": {
            "label": categories[true_class_index],
            "class_index": true_class_index,
        },
        "gradient_loss": direction_result.loss,
        "delta_path": display_path(delta_path),
        "max_epsilon": max_epsilon,
        "max_epsilon_pixels": max_epsilon * 255.0,
        "baseline_top1": baseline_top5[0],
        "baseline_top5": baseline_top5,
        "cases": cases,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_image", type=Path)
    parser.add_argument("--true-label", required=True)
    parser.add_argument(
        "--epsilon-pixels",
        type=float,
        nargs="+",
        default=[0.0, 1.0, 2.0, 4.0, 8.0, 16.0],
        help="Pixel changes measured on the 0–255 scale",
    )
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--delta", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()

    try:
        if any(not 0.0 <= value <= 255.0 for value in args.epsilon_pixels):
            raise ValueError("epsilon-pixels values must be between 0 and 255")
        transforms = WEIGHTS.transforms()
        categories = WEIGHTS.meta["categories"]
        true_class_index = resolve_class_index(args.true_label, categories)
        metadata = generate_fgsm_case_set(
            source_path=args.source_image,
            true_class_index=true_class_index,
            epsilons=[value / 255.0 for value in args.epsilon_pixels],
            output_directory=args.output_directory,
            delta_path=args.delta,
            metadata_path=args.metadata,
            model=load_model(),
            categories=categories,
            mean=transforms.mean,
            std=transforms.std,
            crop_size=int(transforms.crop_size[0]),
            resize_size=int(transforms.resize_size[0]),
            model_preprocess=transforms,
        )
    except (OSError, RuntimeError, ValueError) as error:
        parser.error(str(error))

    changed_count = sum(case["classification_changed"] for case in metadata["cases"])
    print(
        f"Generated {len(metadata['cases'])} FGSM states for "
        f"{metadata['source_path']}; {changed_count} changed classification. "
        f"Metadata: {args.metadata}"
    )


if __name__ == "__main__":
    main()
