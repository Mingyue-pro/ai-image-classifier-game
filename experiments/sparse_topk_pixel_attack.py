"""Run an isolated sparse Top-K gradient pixel-attack feasibility experiment.

This module deliberately does not participate in the game API or runtime flow.
It reuses the project's model, preprocessing statistics, and prediction helpers,
then limits an FGSM-style perturbation to selected spatial pixel locations.
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import torch
import torch.nn.functional as torch_functional
from PIL import Image, ImageDraw
from torch import nn
from torchvision.transforms import functional as vision_functional

from backend.app.fgsm import image_to_pixel_tensor, predict_top5
from backend.app.model import MODEL_NAME, WEIGHTS, load_model


DEFAULT_K_VALUES = [5, 10, 20, 50, 100, 200]
EXTENDED_K_VALUES = [500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000]
DEFAULT_GRID_STRENGTHS = [4.0, 8.0, 16.0, 32.0]
DEFAULT_GRID_K_VALUES = [
    5,
    10,
    20,
    50,
    100,
    200,
    500,
    1_000,
    2_000,
    5_000,
    10_000,
    20_000,
]
RESULT_COLUMNS = [
    "case_id",
    "image",
    "ground_truth",
    "original_top1",
    "original_score",
    "k",
    "strength_pixels",
    "epsilon",
    "attacked_top1",
    "attacked_score",
    "attack_success",
    "selected_pixel_count",
    "changed_pixel_count",
    "minimum_successful_k",
]


@dataclass(frozen=True)
class ExperimentCase:
    case_id: str
    image_path: Path
    expected_label: str


def compute_input_gradient(
    image: torch.Tensor,
    model: nn.Module,
    true_class_index: int,
    preprocess: Any,
) -> torch.Tensor:
    """Return the raw gradient of true-class loss with respect to RGB pixels."""
    differentiable_image = image.detach().clone().requires_grad_(True)
    original_requires_grad = [parameter.requires_grad for parameter in model.parameters()]
    was_training = model.training
    model.eval()
    model.requires_grad_(False)
    try:
        logits = model(preprocess(differentiable_image).unsqueeze(0))
        loss = torch_functional.cross_entropy(
            logits, torch.tensor([true_class_index], device=logits.device)
        )
        loss.backward()
        if differentiable_image.grad is None:
            raise RuntimeError("model did not produce an input gradient")
        return differentiable_image.grad.detach()
    finally:
        for parameter, requires_grad in zip(
            model.parameters(), original_requires_grad, strict=True
        ):
            parameter.requires_grad_(requires_grad)
        model.train(was_training)


def topk_spatial_mask(gradient: torch.Tensor, k: int) -> torch.Tensor:
    """Select K (x, y) locations using summed absolute RGB gradient."""
    if gradient.ndim != 3 or gradient.shape[0] != 3:
        raise ValueError("gradient must be a CHW RGB tensor")
    location_count = gradient.shape[1] * gradient.shape[2]
    if not 1 <= k <= location_count:
        raise ValueError(f"k must be between 1 and {location_count}")
    importance = gradient.abs().sum(dim=0)
    indices = torch.topk(importance.flatten(), k=k, largest=True, sorted=False).indices
    mask = torch.zeros(location_count, dtype=torch.bool, device=gradient.device)
    mask[indices] = True
    return mask.reshape(gradient.shape[1], gradient.shape[2])


def apply_sparse_fgsm(
    image: torch.Tensor, gradient: torch.Tensor, k: int, epsilon: float
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Apply signed-gradient changes only at the selected spatial locations."""
    if image.shape != gradient.shape:
        raise ValueError("image and gradient must have the same shape")
    if not 0.0 <= epsilon <= 1.0:
        raise ValueError("epsilon must be between 0 and 1")
    mask = topk_spatial_mask(gradient, k)
    masked_direction = gradient.sign() * mask.unsqueeze(0)
    attacked = torch.clamp(image + epsilon * masked_direction, 0.0, 1.0)
    return attacked, attacked - image, mask


def load_game_pixel_cases(matrix_path: Path) -> list[ExperimentCase]:
    """Load one unique original source for each configured Pixel/FGSM case."""
    payload = json.loads(matrix_path.read_text(encoding="utf-8"))
    cases: list[ExperimentCase] = []
    seen_sources: set[Path] = set()
    for case in payload.get("cases", []):
        if case.get("attack_type") != "fgsm":
            continue
        source = next(
            (
                Path(state["source_image_path"])
                for state in case.get("states", [])
                if state.get("source_image_path")
            ),
            None,
        )
        if source is None or source in seen_sources:
            continue
        seen_sources.add(source)
        cases.append(
            ExperimentCase(
                case_id=case["case_id"],
                image_path=source,
                expected_label=case["correct_label"],
            )
        )
    return cases


def save_visuals(
    directory: Path,
    original: torch.Tensor,
    attacked: torch.Tensor,
    mask: torch.Tensor,
    epsilon: float,
) -> None:
    """Save original, attacked, mask, highlight, and amplified difference images."""
    directory.mkdir(parents=True, exist_ok=True)
    original_image = vision_functional.to_pil_image(original.cpu())
    attacked_image = vision_functional.to_pil_image(attacked.cpu())
    original_image.save(directory / "original.png")
    attacked_image.save(directory / "attacked.png")

    mask_image = Image.fromarray((mask.cpu().numpy().astype("uint8") * 255), mode="L")
    mask_image.save(directory / "selected-pixel-mask.png")

    highlighted = attacked_image.copy()
    draw = ImageDraw.Draw(highlighted)
    ys, xs = torch.where(mask.cpu())
    for x, y in zip(xs.tolist(), ys.tolist(), strict=True):
        draw.rectangle((x - 2, y - 2, x + 2, y + 2), outline=(255, 0, 255), width=1)
    highlighted.save(directory / "selected-pixels-highlighted.png")

    difference = (attacked - original).abs()
    amplified = torch.clamp(difference / max(epsilon, 1e-12), 0.0, 1.0)
    vision_functional.to_pil_image(amplified.cpu()).save(
        directory / "amplified-difference.png"
    )


def run_experiment(
    cases: Sequence[ExperimentCase],
    output_directory: Path,
    strength_pixels: float = 4.0,
    k_values: Sequence[int] = DEFAULT_K_VALUES,
    extend_until_success: bool = True,
    stop_after_success: bool = False,
) -> dict[str, Any]:
    """Run the sparse attack scan and write machine-readable and visual outputs."""
    model = load_model()
    transforms = WEIGHTS.transforms()
    categories = WEIGHTS.meta["categories"]
    epsilon = strength_pixels / 255.0
    rows: list[dict[str, Any]] = []
    case_summaries: list[dict[str, Any]] = []

    for case in cases:
        with Image.open(case.image_path) as source_image:
            source_image.load()
            image = image_to_pixel_tensor(source_image)
        original_top5 = predict_top5(
            image, model, transforms.mean, transforms.std, categories, preprocess=transforms
        )
        original_top1 = original_top5[0]
        if original_top1["label"].casefold() != case.expected_label.casefold():
            case_summaries.append(
                {
                    "case_id": case.case_id,
                    "image": case.image_path.as_posix(),
                    "status": "skipped_original_not_correct",
                    "expected_label": case.expected_label,
                    "original_top1": original_top1,
                }
            )
            continue

        true_class_index = int(original_top1["class_index"])
        gradient = compute_input_gradient(image, model, true_class_index, transforms)
        tested_k_values = list(dict.fromkeys(int(k) for k in k_values))
        minimum_successful_k: int | None = None
        successful_visual: dict[str, Any] | None = None
        position = 0
        while position < len(tested_k_values):
            k = tested_k_values[position]
            position += 1
            if k > image.shape[1] * image.shape[2]:
                continue
            attacked, _, mask = apply_sparse_fgsm(image, gradient, k, epsilon)
            # Match the game's generated-image path: classification evidence must
            # survive conversion to an 8-bit PNG, not exist only in float memory.
            attacked = image_to_pixel_tensor(
                vision_functional.to_pil_image(attacked.cpu())
            )
            delta = attacked - image.cpu()
            attacked_top1 = predict_top5(
                attacked,
                model,
                transforms.mean,
                transforms.std,
                categories,
                preprocess=transforms,
            )[0]
            success = int(attacked_top1["class_index"]) != true_class_index
            changed_pixel_count = int(torch.count_nonzero(delta.abs().sum(dim=0)))
            row = {
                "case_id": case.case_id,
                "image": case.image_path.as_posix(),
                "ground_truth": case.expected_label,
                "original_top1": original_top1["label"],
                "original_score": original_top1["probability"],
                "k": k,
                "strength_pixels": strength_pixels,
                "epsilon": epsilon,
                "attacked_top1": attacked_top1["label"],
                "attacked_score": attacked_top1["probability"],
                "attack_success": success,
                "selected_pixel_count": int(mask.sum()),
                "changed_pixel_count": changed_pixel_count,
                "minimum_successful_k": None,
            }
            rows.append(row)
            if success and minimum_successful_k is None:
                minimum_successful_k = k
                successful_visual = {
                    "attacked": attacked,
                    "mask": mask,
                    "attacked_top1": attacked_top1,
                }
                if stop_after_success:
                    break
            if position == len(tested_k_values) and minimum_successful_k is None and extend_until_success:
                tested_k_values.extend(
                    k for k in EXTENDED_K_VALUES if k not in tested_k_values
                )

        case_rows = [row for row in rows if row["case_id"] == case.case_id]
        for row in case_rows:
            row["minimum_successful_k"] = minimum_successful_k
        if successful_visual is not None:
            save_visuals(
                output_directory / "visuals" / case.case_id / f"k-{minimum_successful_k}",
                image,
                successful_visual["attacked"],
                successful_visual["mask"],
                epsilon,
            )
        case_summaries.append(
            {
                "case_id": case.case_id,
                "image": case.image_path.as_posix(),
                "status": "completed",
                "ground_truth": case.expected_label,
                "original_top1": original_top1,
                "minimum_successful_k": minimum_successful_k,
                "tested_k_values": [row["k"] for row in case_rows],
                "successful_top1": (
                    successful_visual["attacked_top1"] if successful_visual else None
                ),
            }
        )

    output_directory.mkdir(parents=True, exist_ok=True)
    with (output_directory / "results.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=RESULT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    report = {
        "schema_version": "1.0",
        "experiment": "sparse_topk_gradient_pixel_attack",
        "model_name": MODEL_NAME,
        "weights_name": WEIGHTS.name,
        "strength_pixels": strength_pixels,
        "epsilon": epsilon,
        "importance": "sum_absolute_rgb_gradient_per_spatial_location",
        "cases": case_summaries,
        "results": rows,
    }
    (output_directory / "results.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report


def strength_directory_name(strength_pixels: float) -> str:
    """Return a stable directory label for a strength measured on 0–255."""
    label = f"{strength_pixels:g}".replace(".", "p")
    return f"strength-{label}"


def run_strength_grid(
    cases: Sequence[ExperimentCase],
    output_directory: Path,
    strengths_pixels: Sequence[float],
    k_values: Sequence[int],
) -> dict[str, Any]:
    """Run a finite strength-by-K grid and write one aggregate result set."""
    all_rows: list[dict[str, Any]] = []
    all_summaries: list[dict[str, Any]] = []
    for strength_pixels in strengths_pixels:
        strength_output = output_directory / strength_directory_name(strength_pixels)
        report = run_experiment(
            cases,
            strength_output,
            strength_pixels=strength_pixels,
            k_values=k_values,
            extend_until_success=False,
            stop_after_success=True,
        )
        all_rows.extend(report["results"])
        all_summaries.extend(
            {**summary, "strength_pixels": strength_pixels}
            for summary in report["cases"]
        )

    output_directory.mkdir(parents=True, exist_ok=True)
    with (output_directory / "results.csv").open(
        "w", encoding="utf-8", newline=""
    ) as file:
        writer = csv.DictWriter(file, fieldnames=RESULT_COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)
    aggregate = {
        "schema_version": "1.0",
        "experiment": "sparse_topk_gradient_pixel_attack_strength_grid",
        "model_name": MODEL_NAME,
        "weights_name": WEIGHTS.name,
        "strengths_pixels": list(strengths_pixels),
        "k_values": list(k_values),
        "early_stop_after_first_success": True,
        "importance": "sum_absolute_rgb_gradient_per_spatial_location",
        "cases": all_summaries,
        "results": all_rows,
    }
    (output_directory / "results.json").write_text(
        json.dumps(aggregate, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return aggregate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--case-matrix", type=Path, default=Path("data/results/case-matrix.json")
    )
    parser.add_argument(
        "--case-id", action="append", dest="case_ids", help="Repeat to select cases"
    )
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=Path("experiments/output/sparse-topk-strength-grid-png"),
    )
    parser.add_argument(
        "--strength-pixels", type=float, nargs="+", default=DEFAULT_GRID_STRENGTHS
    )
    parser.add_argument("--k", type=int, nargs="+", default=DEFAULT_GRID_K_VALUES)
    args = parser.parse_args()

    cases = load_game_pixel_cases(args.case_matrix)
    if args.case_ids:
        selected = set(args.case_ids)
        cases = [case for case in cases if case.case_id in selected]
        missing = selected - {case.case_id for case in cases}
        if missing:
            parser.error(f"unknown or non-Pixel case ids: {', '.join(sorted(missing))}")
    report = run_strength_grid(
        cases,
        args.output_directory,
        strengths_pixels=args.strength_pixels,
        k_values=args.k,
    )
    completed = [case for case in report["cases"] if case["status"] == "completed"]
    successful = [case for case in completed if case["minimum_successful_k"] is not None]
    print(
        f"Tested {len(completed)} image-strength combinations; "
        f"{len(successful)} reached attack success within the K grid. Results: "
        f"{args.output_directory / 'results.csv'}"
    )


if __name__ == "__main__":
    main()
