"""State transitions for the single-case Complex Transfer investigation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from PIL import Image, UnidentifiedImageError
from torchvision.transforms import functional as vision_functional

from backend.app.blur import BLUR_RADII, BlurLevel
from backend.app.blur import apply_gaussian_blur
from backend.app.fgsm import image_to_pixel_tensor, load_delta_bundle, reconstruct_fgsm_state
from backend.app.image_manipulation import PatchParameters, apply_patch
from backend.app.inference import ImageClassifier
from backend.app.schemas import Prediction


TransferFactor = Literal["patch", "pixel", "blur"]
NO_CHANGE_MESSAGE = "Please make a change before reclassifying."


class ComplexTransferStateError(ValueError):
    """Raised when a submitted transition violates the Transfer rules."""


@dataclass(frozen=True)
class ComplexTransferAssets:
    original_image_path: Path
    fgsm_delta_path: Path
    patch_image_path: Path


@dataclass(frozen=True)
class ComplexTransferReclassification:
    state: ComplexTransferState
    attempt: ComplexTransferAttempt
    image: Image.Image
    top1: Prediction
    top5: list[Prediction]


@dataclass(frozen=True)
class PatchState:
    size_fraction: float
    position_x: float
    position_y: float

    def __post_init__(self) -> None:
        if not 0 <= self.size_fraction <= 1:
            raise ValueError("Patch size_fraction must be between 0 and 1")
        if not 0 <= self.position_x <= 1 or not 0 <= self.position_y <= 1:
            raise ValueError("Patch position must be between 0 and 1")


@dataclass(frozen=True)
class ComplexTransferParameters:
    patch: PatchState
    pixel_strength: float
    blur_level: BlurLevel

    def __post_init__(self) -> None:
        if not 0 <= self.pixel_strength <= 255:
            raise ValueError("Pixel strength must be between 0 and 255")
        if self.blur_level not in BLUR_RADII:
            raise ValueError(f"Unsupported blur level: {self.blur_level}")

    def as_attempt_parameters(self) -> dict[str, Any]:
        """Return a complete snapshot suitable for an Attempt JSON field."""
        return {
            "patch_enabled": self.patch.size_fraction > 0,
            "patch_size_fraction": self.patch.size_fraction,
            "patch_position_x": self.patch.position_x,
            "patch_position_y": self.patch.position_y,
            "epsilon_pixels": self.pixel_strength,
            "blur_level": self.blur_level,
            "blur_radius": BLUR_RADII[self.blur_level],
        }


@dataclass(frozen=True)
class ClassificationState:
    top1_label: str
    top1_score: float | None = None

    def __post_init__(self) -> None:
        if not self.top1_label:
            raise ValueError("Top-1 label is required")
        if self.top1_score is not None and not 0 <= self.top1_score <= 1:
            raise ValueError("Top-1 score must be between 0 and 1")


@dataclass(frozen=True)
class ComplexTransferAttempt:
    attempt_index: int
    selected_factor: TransferFactor
    prediction: str
    before_parameters: ComplexTransferParameters
    after_parameters: ComplexTransferParameters
    before_classification: ClassificationState
    after_classification: ClassificationState
    success: bool
    timestamp: datetime


@dataclass(frozen=True)
class ComplexTransferState:
    expected_class: str
    current_parameters: ComplexTransferParameters
    current_classification: ClassificationState
    attempt_index: int = 0
    max_attempts: int = 5
    selected_factor: TransferFactor | None = None
    prediction: str | None = None
    success: bool = False
    attempts: tuple[ComplexTransferAttempt, ...] = field(default_factory=tuple)

    @property
    def attempts_remaining(self) -> int:
        return max(0, self.max_attempts - self.attempt_index)

    @property
    def finished(self) -> bool:
        return self.success or self.attempt_index >= self.max_attempts


def initial_complex_transfer_state() -> ComplexTransferState:
    """Return the verified T0 state without encoding any unique repair answer."""
    return ComplexTransferState(
        expected_class="mailbox",
        current_parameters=ComplexTransferParameters(
            patch=PatchState(size_fraction=0.30, position_x=0.75, position_y=0.25),
            pixel_strength=4.0,
            blur_level="high",
        ),
        current_classification=ClassificationState(
            top1_label="punching bag",
            top1_score=0.643236517906189,
        ),
    )


def changed_factors(
    before: ComplexTransferParameters,
    after: ComplexTransferParameters,
) -> set[TransferFactor]:
    """Identify which conceptual factors changed between two full snapshots."""
    changed: set[TransferFactor] = set()
    if before.patch != after.patch:
        changed.add("patch")
    if before.pixel_strength != after.pixel_strength:
        changed.add("pixel")
    if before.blur_level != after.blur_level:
        changed.add("blur")
    return changed


def record_complex_transfer_attempt(
    state: ComplexTransferState,
    *,
    selected_factor: TransferFactor,
    prediction: str,
    after_parameters: ComplexTransferParameters,
    after_classification: ClassificationState,
    timestamp: datetime | None = None,
) -> tuple[ComplexTransferState, ComplexTransferAttempt]:
    """Record one valid single-factor transition and carry its state forward."""
    if state.finished:
        raise ComplexTransferStateError("Complex Transfer is already finished.")
    if not prediction.strip():
        raise ComplexTransferStateError("A prediction is required before reclassifying.")

    factors = changed_factors(state.current_parameters, after_parameters)
    if not factors:
        raise ComplexTransferStateError(NO_CHANGE_MESSAGE)
    if factors != {selected_factor}:
        raise ComplexTransferStateError(
            f"Only the selected {selected_factor} factor may change in one attempt."
        )

    recorded_at = timestamp or datetime.now(timezone.utc)
    if recorded_at.tzinfo is None:
        raise ComplexTransferStateError("Attempt timestamp must include a timezone.")
    next_index = state.attempt_index + 1
    success = after_classification.top1_label.casefold() == state.expected_class.casefold()
    attempt = ComplexTransferAttempt(
        attempt_index=next_index,
        selected_factor=selected_factor,
        prediction=prediction.strip(),
        before_parameters=state.current_parameters,
        after_parameters=after_parameters,
        before_classification=state.current_classification,
        after_classification=after_classification,
        success=success,
        timestamp=recorded_at,
    )
    next_state = ComplexTransferState(
        expected_class=state.expected_class,
        current_parameters=after_parameters,
        current_classification=after_classification,
        attempt_index=next_index,
        max_attempts=state.max_attempts,
        selected_factor=selected_factor,
        prediction=prediction.strip(),
        success=success,
        attempts=(*state.attempts, attempt),
    )
    return next_state, attempt


def generate_complex_transfer_image(
    assets: ComplexTransferAssets,
    parameters: ComplexTransferParameters,
) -> Image.Image:
    """Build one state in the fixed Original → FGSM → Blur → Patch order."""
    try:
        with Image.open(assets.original_image_path) as source:
            source.load()
            source_tensor = image_to_pixel_tensor(source)
        bundle = load_delta_bundle(assets.fgsm_delta_path)
        pixel_modified, _ = reconstruct_fgsm_state(
            source_tensor,
            bundle,
            parameters.pixel_strength / 255.0,
        )
        current = vision_functional.to_pil_image(pixel_modified.cpu()).convert("RGB")
        current = apply_gaussian_blur(current, parameters.blur_level).image
        if parameters.patch.size_fraction == 0:
            return current
        with Image.open(assets.patch_image_path) as patch:
            patch.load()
            return apply_patch(
                current,
                patch,
                PatchParameters(
                    position_x=parameters.patch.position_x,
                    position_y=parameters.patch.position_y,
                    size=parameters.patch.size_fraction,
                ),
            ).image
    except (OSError, UnidentifiedImageError) as error:
        raise ComplexTransferStateError(f"Could not read Complex Transfer assets: {error}") from error


def reclassify_complex_transfer(
    state: ComplexTransferState,
    *,
    selected_factor: TransferFactor,
    prediction: str,
    after_parameters: ComplexTransferParameters,
    assets: ComplexTransferAssets,
    classifier: ImageClassifier,
    output_path: Path,
    timestamp: datetime | None = None,
) -> ComplexTransferReclassification:
    """Generate and classify one valid state, then record its factual transition."""
    factors = changed_factors(state.current_parameters, after_parameters)
    if not factors:
        raise ComplexTransferStateError(NO_CHANGE_MESSAGE)
    if factors != {selected_factor}:
        raise ComplexTransferStateError(
            f"Only the selected {selected_factor} factor may change in one attempt."
        )
    if state.finished:
        raise ComplexTransferStateError("Complex Transfer is already finished.")

    generated = generate_complex_transfer_image(assets, after_parameters)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    generated.save(output_path, format="PNG")
    try:
        with Image.open(output_path) as saved:
            saved.load()
            displayed = saved.convert("RGB").copy()
    except (OSError, UnidentifiedImageError) as error:
        raise ComplexTransferStateError(f"Could not reload Complex Transfer image: {error}") from error
    classification = classifier.classify(displayed)
    next_state, attempt = record_complex_transfer_attempt(
        state,
        selected_factor=selected_factor,
        prediction=prediction,
        after_parameters=after_parameters,
        after_classification=ClassificationState(
            top1_label=classification.top1.label,
            top1_score=classification.top1.probability,
        ),
        timestamp=timestamp,
    )
    return ComplexTransferReclassification(
        state=next_state,
        attempt=attempt,
        image=displayed,
        top1=classification.top1,
        top5=classification.top5,
    )
