"""Manually test one Patch + Pixel + Blur Transfer candidate.

Edit only the CONFIG block below, then run this file once. The script deliberately
contains no parameter sweep or automatic recommendation logic.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image
from torchvision.transforms import functional as vision_functional


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if PROJECT_ROOT.as_posix() not in sys.path:
    sys.path.insert(0, PROJECT_ROOT.as_posix())

from backend.app.blur import BLUR_RADII, BlurLevel, apply_gaussian_blur
from backend.app.fgsm import (
    image_to_pixel_tensor,
    load_delta_bundle,
    reconstruct_fgsm_state,
)
from backend.app.image_manipulation import PatchParameters, apply_patch
from backend.app.inference import ResNet34InferenceService


@dataclass(frozen=True)
class TransferExperimentConfig:
    # Image: use a path relative to the project root, or an absolute path.
    image_path: str = "data/raw/candidate/icecream.png"
    expected_human_class: str = "ice cream"

    # The saved FGSM direction must have been generated for this same image.
    fgsm_delta_path: str = "data/perturbations/fgsm-screen/icecream.pt"
    pixel_strength: float = 0.0  # Displayed and applied as 4/255.

    patch_enabled: bool = True
    patch_path: str = "data/perturbations/patches/toaster-universal.png"
    patch_size: float = 0.30
    patch_position_x: float = 0.60
    patch_position_y: float = 0.20

    # Phase 1 radii: none=0, low=4, medium=8, high=16 source-image pixels.
    blur_level: BlurLevel = "low"

    # Each run overwrites these two files so the latest manual test is obvious.
    output_image_path: str = "experiments/output/transfer_current.png"
    output_metadata_path: str = "experiments/output/transfer_current.json"


# ---------------------------------------------------------------------------
# MANUAL CONFIGURATION: change one or more values here before each run.
# ---------------------------------------------------------------------------
CONFIG = TransferExperimentConfig()


def resolve_path(value: str, *, must_exist: bool) -> Path:
    path = Path(value).expanduser()
    resolved = path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()
    if must_exist and not resolved.is_file():
        raise FileNotFoundError(f"Required experiment file does not exist: {resolved}")
    return resolved


def build_transfer_image(config: TransferExperimentConfig) -> Image.Image:
    """Rebuild one image in the fixed Original → FGSM → Blur → Patch order."""
    image_path = resolve_path(config.image_path, must_exist=True)
    delta_path = resolve_path(config.fgsm_delta_path, must_exist=True)
    with Image.open(image_path) as source:
        source.load()
        original_tensor = image_to_pixel_tensor(source)

    if not 0 <= config.pixel_strength <= 255:
        raise ValueError("pixel_strength must be between 0 and 255")
    bundle = load_delta_bundle(delta_path)
    pixel_modified, _ = reconstruct_fgsm_state(
        original_tensor,
        bundle,
        config.pixel_strength / 255.0,
    )
    current = vision_functional.to_pil_image(pixel_modified.cpu()).convert("RGB")
    current = apply_gaussian_blur(current, config.blur_level).image

    if config.patch_enabled:
        patch_path = resolve_path(config.patch_path, must_exist=True)
        with Image.open(patch_path) as patch:
            patch.load()
            current = apply_patch(
                current,
                patch,
                PatchParameters(
                    position_x=config.patch_position_x,
                    position_y=config.patch_position_y,
                    size=config.patch_size,
                ),
            ).image
    return current


def run_manual_experiment(config: TransferExperimentConfig) -> dict[str, object]:
    """Generate, save, classify, and print exactly one configured combination."""
    final_image = build_transfer_image(config)
    output_image = resolve_path(config.output_image_path, must_exist=False)
    output_metadata = resolve_path(config.output_metadata_path, must_exist=False)
    output_image.parent.mkdir(parents=True, exist_ok=True)
    output_metadata.parent.mkdir(parents=True, exist_ok=True)
    final_image.save(output_image, format="PNG")

    classification = ResNet34InferenceService().classify(final_image)
    top1 = classification.top1
    correct = top1.label.casefold() == config.expected_human_class.casefold()
    result: dict[str, object] = {
        "image": Path(config.image_path).name,
        "expected_human_class": config.expected_human_class,
        "pipeline": ["Original", "FGSM", "Gaussian Blur", "Patch"],
        "patch": {
            "enabled": config.patch_enabled,
            "size": config.patch_size if config.patch_enabled else None,
            "position_x": config.patch_position_x if config.patch_enabled else None,
            "position_y": config.patch_position_y if config.patch_enabled else None,
        },
        "pixel": {
            "strength_pixels": config.pixel_strength,
            "epsilon": config.pixel_strength / 255.0,
        },
        "blur": {
            "level": config.blur_level,
            "radius": BLUR_RADII[config.blur_level],
        },
        "prediction": {
            "top1": top1.label,
            "score": top1.probability,
            "expected": config.expected_human_class,
            "correct": correct,
        },
        "output_image": output_image.relative_to(PROJECT_ROOT).as_posix(),
        "config": asdict(config),
    }
    output_metadata.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    patch_state = "disabled" if not config.patch_enabled else (
        f"enabled = True\n"
        f"size = {config.patch_size}\n"
        f"position = ({config.patch_position_x}, {config.patch_position_y})"
    )
    print(
        f"Image: {Path(config.image_path).name}\n"
        f"Expected human class: {config.expected_human_class}\n\n"
        f"Patch:\n{patch_state}\n\n"
        f"Pixel:\nstrength = {config.pixel_strength:g}/255 "
        f"(epsilon = {config.pixel_strength / 255.0:.8f})\n\n"
        f"Blur:\nlevel = {config.blur_level}\n"
        f"radius = {BLUR_RADII[config.blur_level]:g}\n\n"
        f"Prediction:\nTop-1 = {top1.label}\n"
        f"Score = {top1.probability:.6f}\n"
        f"Expected = {config.expected_human_class}\n"
        f"Correct = {correct}\n\n"
        f"Saved image: {output_image}\n"
        f"Saved metadata: {output_metadata}"
    )
    return result


if __name__ == "__main__":
    run_manual_experiment(CONFIG)
