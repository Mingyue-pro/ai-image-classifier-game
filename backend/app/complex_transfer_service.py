"""Formal initialization, preview, and Attempt persistence for Complex Transfer."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast
from uuid import uuid4

from PIL import Image

from backend.app.complex_transfer import (
    NO_CHANGE_MESSAGE,
    ClassificationState,
    ComplexTransferAssets,
    ComplexTransferParameters,
    ComplexTransferState,
    ComplexTransferStateError,
    PatchState,
    TransferFactor,
    changed_factors,
    generate_complex_transfer_image,
    reclassify_complex_transfer,
)
from backend.app.game_schemas import (
    ComplexPatchState,
    ComplexTransferActionRead,
    ComplexTransferAttemptRead,
    ComplexTransferParametersRead,
    ComplexTransferPreviewRead,
    ComplexTransferRunRead,
    ComplexTransferReflectionRead,
)
from backend.app.inference import ImageClassifier
from backend.app.repositories.research_repository import ResearchRepository
from backend.app.schemas import Prediction


CASE_ID = "complex-transfer-mailbox"
EXPECTED_CLASS = "mailbox"
MAX_ATTEMPTS = 5
VALID_FACTORS = {"patch", "pixel", "blur"}
REFERENCE_PARAMETERS = ComplexTransferParameters(PatchState(0.0, 0.75, 0.25), 0.5, "none")
LEARNING_REFLECTION_KEY = "complex_transfer_learning_reflection"
NEW_ERROR_STRATEGY_KEY = "complex_transfer_new_error_strategy"


class ComplexTransferService:
    def __init__(self, repository: ResearchRepository, classifier: ImageClassifier, project_root: Path, runtime_root: Path) -> None:
        self.repository = repository
        self.classifier = classifier
        self.project_root = project_root.resolve()
        self.runtime_root = runtime_root.resolve()
        self.assets = ComplexTransferAssets(
            self.project_root / "data/raw/candidate/final-transfer/mailbox-01/original.jpeg",
            self.project_root / "data/perturbations/fgsm-final-transfer/mailbox-01.pt",
            self.project_root / "data/perturbations/patches/mailbox-01-toaster.png",
        )

    @staticmethod
    def initial_parameters() -> ComplexTransferParameters:
        return ComplexTransferParameters(PatchState(0.30, 0.75, 0.25), 4.0, "high")

    def initialize(self, session_id: str) -> ComplexTransferRunRead:
        stage_run = self.repository.get_latest_stage_run_for_case(session_id, CASE_ID)
        if stage_run is None:
            image = generate_complex_transfer_image(self.assets, self.initial_parameters())
            initial_path = self.runtime_root / "complex-transfer" / session_id / "initial.png"
            initial_path.parent.mkdir(parents=True, exist_ok=True)
            image.save(initial_path, format="PNG")
            with Image.open(initial_path) as saved:
                saved.load()
                classification = self.classifier.classify(saved.convert("RGB"))
            stage_run = self.repository.start_stage_run(
                session_id, CASE_ID, "transfer", "complex", classification.top1.label
            )
            self.repository.record_event(
                session_id,
                "complex_transfer_initialized",
                {"top1": classification.top1.model_dump(), "parameters": self.initial_parameters().as_attempt_parameters()},
                stage_run.id,
            )
        else:
            state = self._state(stage_run.id)
            if state.finished and stage_run.completion_status != "completed":
                stage_run = self.repository.complete_stage_run(
                    stage_run.id,
                    success=state.success,
                    final_top1_label=state.current_classification.top1_label,
                    classification_restored=state.success,
                    fallback_shown=False,
                )
        return self._run_read(stage_run.id)

    def preview(self, stage_run_id: str, selected_factor: str, submitted: ComplexTransferParametersRead) -> ComplexTransferPreviewRead:
        state = self._state(stage_run_id)
        factor = self._factor(selected_factor)
        after = self._parameters(submitted)
        self._validate_single_change(state.current_parameters, after, factor)
        image = generate_complex_transfer_image(self.assets, after)
        path = self.runtime_root / stage_run_id / "complex-preview.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, format="PNG")
        return ComplexTransferPreviewRead(
            image_url=f"/game/complex-transfer-runs/{stage_run_id}/preview/image",
            parameters=self._parameters_read(after),
        )

    def reclassify(self, stage_run_id: str, selected_factor: str, prediction: str, prediction_reason: str | None, submitted: ComplexTransferParametersRead) -> ComplexTransferActionRead:
        state = self._state(stage_run_id)
        factor = self._factor(selected_factor)
        after = self._parameters(submitted)
        output_path = self.runtime_root / stage_run_id / f"candidate-{uuid4()}.png"
        result = reclassify_complex_transfer(
            state,
            selected_factor=factor,
            prediction=prediction,
            after_parameters=after,
            assets=self.assets,
            classifier=self.classifier,
            output_path=output_path,
        )
        attempt = self.repository.record_attempt(
            stage_run_id,
            tool_type=f"complex_transfer_{factor}",
            parameters_before=state.current_parameters.as_attempt_parameters(),
            parameters_after=after.as_attempt_parameters(),
            predicted_outcome=prediction,
            prediction_reason=prediction_reason,
            top1_before=state.current_classification.top1_label,
            top1_after=result.top1.label,
            top5_after=[item.model_dump() for item in result.top5],
            classification_changed=result.top1.label != state.current_classification.top1_label,
            correct_label_is_top1=result.top1.label.casefold() == EXPECTED_CLASS.casefold(),
            classification_restored=result.state.success,
            output_image_path=output_path.relative_to(self.runtime_root).as_posix(),
        )
        if result.state.finished:
            self.repository.complete_stage_run(
                stage_run_id,
                success=result.state.success,
                final_top1_label=result.top1.label,
                classification_restored=result.state.success,
                fallback_shown=False,
            )
        return ComplexTransferActionRead(
            stage_run_id=stage_run_id,
            attempt_index=attempt.attempt_number,
            image_url=f"/game/stage-runs/{stage_run_id}/attempts/{attempt.attempt_number}/image",
            selected_factor=factor,
            prediction=prediction,
            before_parameters=self._parameters_read(state.current_parameters),
            after_parameters=self._parameters_read(after),
            before_top1=self._prediction_for_state(state.current_classification),
            after_top1=result.top1,
            classification_restored=result.state.success,
            remaining_attempts=result.state.attempts_remaining,
        )

    def initial_image_path(self, stage_run_id: str) -> Path:
        run = self.repository.get_stage_run(stage_run_id)
        self._require_complex(run.case_id)
        return self.runtime_root / "complex-transfer" / run.session_id / "initial.png"

    def original_image_path(self, stage_run_id: str) -> Path:
        self._require_complex(self.repository.get_stage_run(stage_run_id).case_id)
        return self.assets.original_image_path

    def preview_image_path(self, stage_run_id: str) -> Path:
        self._require_complex(self.repository.get_stage_run(stage_run_id).case_id)
        return self.runtime_root / stage_run_id / "complex-preview.png"

    def read_reflection(self, stage_run_id: str) -> ComplexTransferReflectionRead:
        run = self.repository.get_stage_run(stage_run_id)
        self._require_complex(run.case_id)
        learning = self.repository.get_stage_response(stage_run_id, LEARNING_REFLECTION_KEY)
        strategy = self.repository.get_stage_response(stage_run_id, NEW_ERROR_STRATEGY_KEY)
        return ComplexTransferReflectionRead(
            stage_run_id=stage_run_id,
            completed=learning is not None and strategy is not None,
            learning_reflection=learning.answer_text if learning else None,
            new_error_strategy=strategy.answer_text if strategy else None,
        )

    def save_reflection(
        self,
        stage_run_id: str,
        learning_reflection: str,
        new_error_strategy: str,
    ) -> ComplexTransferReflectionRead:
        run = self.repository.get_stage_run(stage_run_id)
        self._require_complex(run.case_id)
        state = self._state(stage_run_id)
        if not state.finished:
            raise ComplexTransferStateError(
                "Complex Transfer must finish before reflection can be submitted."
            )
        if not learning_reflection.strip() or not new_error_strategy.strip():
            raise ComplexTransferStateError("Both reflection responses are required.")

        existing_learning = self.repository.get_stage_response(
            stage_run_id, LEARNING_REFLECTION_KEY
        )
        existing_strategy = self.repository.get_stage_response(
            stage_run_id, NEW_ERROR_STRATEGY_KEY
        )
        if existing_learning and existing_learning.answer_text != learning_reflection:
            raise ComplexTransferStateError("Transfer reflection has already been submitted.")
        if existing_strategy and existing_strategy.answer_text != new_error_strategy:
            raise ComplexTransferStateError("Transfer reflection has already been submitted.")

        if existing_learning is None:
            self.repository.save_response(
                run.session_id,
                LEARNING_REFLECTION_KEY,
                1,
                "text",
                stage_run_id=stage_run_id,
                answer_text=learning_reflection,
            )
        if existing_strategy is None:
            self.repository.save_response(
                run.session_id,
                NEW_ERROR_STRATEGY_KEY,
                1,
                "text",
                stage_run_id=stage_run_id,
                answer_text=new_error_strategy,
            )
        return self.read_reflection(stage_run_id)

    def _run_read(self, stage_run_id: str) -> ComplexTransferRunRead:
        state = self._state(stage_run_id)
        stage_run = self.repository.get_stage_run(stage_run_id)
        latest = self.repository.get_latest_attempt(stage_run_id)
        attempts = self.repository.get_attempts(stage_run_id)
        image_url = (
            f"/game/stage-runs/{stage_run_id}/attempts/{latest.attempt_number}/image"
            if latest else f"/game/complex-transfer-runs/{stage_run_id}/initial/image"
        )
        return ComplexTransferRunRead(
            stage_run_id=stage_run_id,
            image_url=image_url,
            original_image_url=f"/game/complex-transfer-runs/{stage_run_id}/original/image",
            expected_class=EXPECTED_CLASS,
            current_top1=self._prediction_for_state(state.current_classification),
            current_parameters=self._parameters_read(state.current_parameters),
            attempt_index=state.attempt_index,
            remaining_attempts=state.attempts_remaining,
            max_attempts=state.max_attempts,
            success=state.success,
            finished=state.finished,
            exhausted=state.attempt_index >= state.max_attempts and not state.success,
            initial_top1_label=stage_run.initial_top1_label or "unknown",
            attempts=[self._attempt_read(item) for item in attempts],
            reference_recoverable_parameters=self._parameters_read(REFERENCE_PARAMETERS),
            reference_top1_label=EXPECTED_CLASS,
        )

    def _attempt_read(self, attempt: Any) -> ComplexTransferAttemptRead:
        factor = attempt.tool_type.removeprefix("complex_transfer_")
        if factor not in VALID_FACTORS:
            raise ComplexTransferStateError("Complex Transfer Attempt has an invalid factor")
        return ComplexTransferAttemptRead(
            attempt_number=attempt.attempt_number,
            selected_factor=cast(Any, factor),
            prediction=attempt.predicted_outcome or "not_sure",
            before_parameters=self._parameters_read(self._parameters_from_snapshot(attempt.parameters_before or {})),
            after_parameters=self._parameters_read(self._parameters_from_snapshot(attempt.parameters_after)),
            before_classification=attempt.top1_before or "unknown",
            after_classification=attempt.top1_after,
            classification_restored=attempt.classification_restored,
            timestamp=attempt.created_at,
        )

    def _state(self, stage_run_id: str) -> ComplexTransferState:
        run = self.repository.get_stage_run(stage_run_id)
        self._require_complex(run.case_id)
        latest = self.repository.get_latest_attempt(stage_run_id)
        if latest:
            parameters = self._parameters_from_snapshot(latest.parameters_after)
            prediction = self._prediction_from_attempt(latest.top1_after, latest.top5_after)
        else:
            parameters = self.initial_parameters()
            initialized = self.repository.get_latest_event(stage_run_id, "complex_transfer_initialized")
            top1 = initialized.event_data.get("top1") if initialized and isinstance(initialized.event_data, dict) else None
            prediction = Prediction.model_validate(top1 or {"label": run.initial_top1_label or "unknown", "probability": 0, "class_index": 0})
        return ComplexTransferState(
            expected_class=EXPECTED_CLASS,
            current_parameters=parameters,
            current_classification=ClassificationState(prediction.label, prediction.probability),
            attempt_index=run.attempt_count,
            max_attempts=MAX_ATTEMPTS,
            success=bool(run.classification_restored),
        )

    @staticmethod
    def _parameters(value: ComplexTransferParametersRead) -> ComplexTransferParameters:
        return ComplexTransferParameters(
            PatchState(value.patch.size_fraction, value.patch.position_x, value.patch.position_y),
            value.pixel_strength,
            cast(Any, value.blur_level),
        )

    @staticmethod
    def _parameters_read(value: ComplexTransferParameters) -> ComplexTransferParametersRead:
        return ComplexTransferParametersRead(
            patch=ComplexPatchState(size_fraction=value.patch.size_fraction, position_x=value.patch.position_x, position_y=value.patch.position_y),
            pixel_strength=value.pixel_strength,
            blur_level=value.blur_level,
        )

    @staticmethod
    def _parameters_from_snapshot(value: dict[str, Any]) -> ComplexTransferParameters:
        return ComplexTransferParameters(
            PatchState(float(value["patch_size_fraction"]), float(value["patch_position_x"]), float(value["patch_position_y"])),
            float(value["epsilon_pixels"]), cast(Any, value["blur_level"]),
        )

    @staticmethod
    def _prediction_from_attempt(label: str, top5: list[dict[str, Any]] | None) -> Prediction:
        match = next((item for item in top5 or [] if item.get("label") == label), None)
        return Prediction.model_validate(match or {"label": label, "probability": 0, "class_index": 0})

    @staticmethod
    def _prediction_for_state(value: ClassificationState) -> Prediction:
        return Prediction(label=value.top1_label, probability=value.top1_score or 0, class_index=0)

    @staticmethod
    def _factor(value: str) -> TransferFactor:
        if value not in VALID_FACTORS:
            raise ComplexTransferStateError("selected_factor must be patch, pixel, or blur")
        return cast(TransferFactor, value)

    @staticmethod
    def _validate_single_change(before: ComplexTransferParameters, after: ComplexTransferParameters, factor: TransferFactor) -> None:
        factors = changed_factors(before, after)
        if not factors:
            raise ComplexTransferStateError(NO_CHANGE_MESSAGE)
        if factors != {factor}:
            raise ComplexTransferStateError(f"Only the selected {factor} factor may change in one attempt.")

    @staticmethod
    def _require_complex(case_id: str) -> None:
        if case_id != CASE_ID:
            raise ComplexTransferStateError("StageRun is not a Complex Transfer run")
