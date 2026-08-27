from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import Image

from backend.app.complex_transfer import (
    NO_CHANGE_MESSAGE,
    ClassificationState,
    ComplexTransferAssets,
    ComplexTransferStateError,
    initial_complex_transfer_state,
    reclassify_complex_transfer,
    record_complex_transfer_attempt,
)
from backend.app.fgsm import create_delta_bundle, image_to_pixel_tensor, save_delta_bundle
from backend.app.schemas import ClassificationResponse, Prediction


class RecordingClassifier:
    def __init__(self, label: str) -> None:
        self.label = label
        self.images: list[Image.Image] = []

    def classify(self, image: Image.Image) -> ClassificationResponse:
        self.images.append(image.copy())
        prediction = Prediction(label=self.label, probability=0.73, class_index=1)
        return ClassificationResponse(model_name="resnet34", weights_name="test", top1=prediction, top5=[prediction])


def test_t0_contains_the_verified_initial_combination() -> None:
    state = initial_complex_transfer_state()

    assert state.current_parameters.as_attempt_parameters() == {
        "patch_enabled": True,
        "patch_size_fraction": 0.30,
        "patch_position_x": 0.75,
        "patch_position_y": 0.25,
        "epsilon_pixels": 4.0,
        "blur_level": "high",
        "blur_radius": 16.0,
    }
    assert state.current_classification.top1_label == "punching bag"
    assert state.expected_class == "mailbox"
    assert state.attempt_index == 0
    assert state.attempts_remaining == 5
    assert not state.success


def test_one_factor_changes_and_other_current_values_persist() -> None:
    state = initial_complex_transfer_state()
    changed_patch = replace(
        state.current_parameters,
        patch=replace(state.current_parameters.patch, size_fraction=0.20),
    )

    next_state, attempt = record_complex_transfer_attempt(
        state,
        selected_factor="patch",
        prediction="remain incorrect",
        after_parameters=changed_patch,
        after_classification=ClassificationState("toaster", 0.42),
        timestamp=datetime(2026, 8, 16, tzinfo=timezone.utc),
    )

    assert attempt.before_parameters == state.current_parameters
    assert attempt.after_parameters.patch.size_fraction == 0.20
    assert attempt.after_parameters.pixel_strength == 4
    assert attempt.after_parameters.blur_level == "high"
    assert attempt.before_classification.top1_label == "punching bag"
    assert attempt.after_classification.top1_label == "toaster"
    assert next_state.current_parameters == attempt.after_parameters
    assert next_state.attempt_index == 1
    assert next_state.attempts_remaining == 4


def test_later_attempt_starts_from_the_previous_attempt_state() -> None:
    state = initial_complex_transfer_state()
    patch_parameters = replace(
        state.current_parameters,
        patch=replace(state.current_parameters.patch, size_fraction=0.10),
    )
    state, _ = record_complex_transfer_attempt(
        state,
        selected_factor="patch",
        prediction="classification may change",
        after_parameters=patch_parameters,
        after_classification=ClassificationState("toaster"),
    )
    pixel_parameters = replace(state.current_parameters, pixel_strength=0)

    state, second_attempt = record_complex_transfer_attempt(
        state,
        selected_factor="pixel",
        prediction="classification may change",
        after_parameters=pixel_parameters,
        after_classification=ClassificationState("eggnog"),
    )

    assert second_attempt.before_parameters.patch.size_fraction == 0.10
    assert second_attempt.before_parameters.pixel_strength == 4
    assert second_attempt.after_parameters.patch.size_fraction == 0.10
    assert second_attempt.after_parameters.blur_level == "high"
    assert state.attempt_index == 2


def test_unchanged_parameters_do_not_create_an_attempt() -> None:
    state = initial_complex_transfer_state()

    with pytest.raises(ComplexTransferStateError, match=NO_CHANGE_MESSAGE):
        record_complex_transfer_attempt(
            state,
            selected_factor="blur",
            prediction="remain incorrect",
            after_parameters=state.current_parameters,
            after_classification=ClassificationState("toaster"),
        )

    assert state.attempt_index == 0
    assert state.attempts == ()


def test_changing_more_than_the_selected_factor_is_rejected() -> None:
    state = initial_complex_transfer_state()
    invalid = replace(
        state.current_parameters,
        pixel_strength=2,
        blur_level="medium",
    )

    with pytest.raises(ComplexTransferStateError, match="Only the selected pixel"):
        record_complex_transfer_attempt(
            state,
            selected_factor="pixel",
            prediction="classification may change",
            after_parameters=invalid,
            after_classification=ClassificationState("toaster"),
        )


def test_correct_classification_finishes_without_encoding_a_repair_combination() -> None:
    state = initial_complex_transfer_state()
    changed = replace(state.current_parameters, blur_level="low")

    state, attempt = record_complex_transfer_attempt(
        state,
        selected_factor="blur",
        prediction="restore the expected class",
        after_parameters=changed,
        after_classification=ClassificationState("mailbox", 0.61),
    )

    assert attempt.success
    assert state.success
    assert state.finished
    with pytest.raises(ComplexTransferStateError, match="already finished"):
        record_complex_transfer_attempt(
            state,
            selected_factor="pixel",
            prediction="change",
            after_parameters=replace(state.current_parameters, pixel_strength=0),
            after_classification=ClassificationState("mailbox"),
        )


def test_fifth_unsuccessful_attempt_finishes_without_fallback() -> None:
    state = initial_complex_transfer_state()
    blur_levels = ["medium", "low", "none", "low", "medium"]
    for blur_level in blur_levels:
        state, _ = record_complex_transfer_attempt(
            state,
            selected_factor="blur",
            prediction="remain incorrect",
            after_parameters=replace(state.current_parameters, blur_level=blur_level),
            after_classification=ClassificationState("toaster"),
        )

    assert state.attempt_index == 5
    assert state.attempts_remaining == 0
    assert state.finished
    assert not state.success
    assert len(state.attempts) == 5


def test_reclassification_rebuilds_saves_and_calls_the_classifier(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    patch_path = tmp_path / "patch.png"
    delta_path = tmp_path / "delta.pt"
    output_path = tmp_path / "runtime" / "attempt-1.png"
    source = Image.new("RGB", (32, 32), (30, 90, 150))
    source.save(source_path)
    Image.new("RGBA", (8, 8), (230, 30, 10, 255)).save(patch_path)
    tensor = image_to_pixel_tensor(source)
    save_delta_bundle(
        create_delta_bundle(tensor, tensor.new_ones(tensor.shape), 4 / 255),
        delta_path,
    )
    state = initial_complex_transfer_state()
    parameters = replace(state.current_parameters, blur_level="low")
    classifier = RecordingClassifier("mailbox")

    result = reclassify_complex_transfer(
        state,
        selected_factor="blur",
        prediction="restore_correct",
        after_parameters=parameters,
        assets=ComplexTransferAssets(source_path, delta_path, patch_path),
        classifier=classifier,
        output_path=output_path,
    )

    assert output_path.is_file()
    assert len(classifier.images) == 1
    assert classifier.images[0].mode == "RGB"
    assert result.top1.label == "mailbox"
    assert result.attempt.before_classification.top1_label == "punching bag"
    assert result.attempt.after_classification.top1_label == "mailbox"
    assert result.state.success
    assert result.state.attempts_remaining == 4
