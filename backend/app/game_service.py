"""Trusted case display, image manipulation, classification, and Attempt recording."""

from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from torchvision.transforms import functional as vision_functional

from backend.app.case_catalog import CaseCatalog
from backend.app.fgsm import (
    image_to_pixel_tensor,
    load_delta_bundle,
    reconstruct_fgsm_state,
)
from backend.app.game_schemas import (
    GameActionRead,
    PlayerCaseRead,
    PlayerCaseState,
    PreviewRead,
)
from backend.app.image_manipulation import PatchParameters, apply_patch
from backend.app.inference import ImageClassifier
from backend.app.repositories.research_repository import ResearchRepository
from backend.app.schemas import Prediction


PATCH_TOOLS = {"move_patch", "resize_patch", "move_and_resize_patch", "adjust_patch"}
FGSM_TOOLS = {"change_epsilon", "reduce_epsilon", "remove_perturbation"}


class GameServiceError(ValueError):
    """Base error for trusted game operations."""


class GameInputError(GameServiceError):
    """Raised when a player submits an invalid action or parameter."""


class GameConflictError(GameServiceError):
    """Raised when an action conflicts with the current Stage state."""


class GameAssetError(GameServiceError):
    """Raised when a trusted local image, Patch, or delta is unavailable."""


class GameService:
    """Run trusted game actions using cases, files, inference, and persistence."""

    def __init__(
        self,
        case_catalog: CaseCatalog,
        repository: ResearchRepository,
        classifier: ImageClassifier,
        project_root: Path,
        runtime_root: Path,
    ) -> None:
        self.case_catalog = case_catalog
        self.repository = repository
        self.classifier = classifier
        self.project_root = project_root.resolve()
        self.runtime_root = runtime_root.resolve()

    def get_player_case(self, case_id: str) -> PlayerCaseRead:
        """Return player-safe case content without labels for hidden outcomes."""
        case = self.case_catalog.get_case(case_id)
        initial_state = self._get_state(case, self._required_text(case, "initial_state_id"))
        initial_top1 = self._prediction(initial_state.get("top1"))
        available_states = []
        if case.get("interaction_mode") == "offline_choices":
            available_states = [
                PlayerCaseState(
                    state_id=self._required_text(state, "state_id"),
                    role=self._required_text(state, "role"),
                    image_url=self.case_image_url(
                        case_id, self._required_text(state, "state_id")
                    ),
                    parameters=self._parameters(state),
                )
                for state in self._states(case)
                if state.get("role") == "offline_option"
            ]
        return PlayerCaseRead(
            case_id=self._required_text(case, "case_id"),
            stage=self._required_text(case, "stage"),
            subject=self._required_text(case, "subject"),
            attack_type=self._required_text(case, "attack_type"),
            interaction_mode=self._required_text(case, "interaction_mode"),
            correct_label=self._required_text(case, "correct_label"),
            initial_state_id=self._required_text(case, "initial_state_id"),
            initial_image_url=self.case_image_url(case_id, initial_state["state_id"]),
            original_image_url=f"/game/cases/{case_id}/original-image",
            initial_top1=initial_top1,
            parameter_rules=self._parameter_rules(case),
            max_attempts=case.get("max_attempts"),
            available_states=available_states,
        )

    def get_case_image_path(self, case_id: str, state_id: str) -> Path:
        """Return a trusted image path only when it belongs to the requested case."""
        case = self.case_catalog.get_case(case_id)
        state = self._get_state(case, state_id)
        return self._trusted_project_file(self._required_text(state, "image_path"))

    def get_case_original_image_path(self, case_id: str) -> Path:
        """Return the trusted unmodified source image configured for a case."""
        case = self.case_catalog.get_case(case_id)
        initial_state = self._get_state(case, self._required_text(case, "initial_state_id"))
        source_path = initial_state.get("source_image_path") or initial_state.get("image_path")
        return self._trusted_project_file(
            self._required_text({"source_path": source_path}, "source_path")
        )

    def get_attempt_image_path(self, stage_run_id: str, attempt_number: int) -> Path:
        """Return a trusted runtime image path for an existing recorded Attempt."""
        attempt = self.repository.get_attempt(stage_run_id, attempt_number)
        if not attempt.output_image_path:
            raise GameAssetError("Attempt does not have an output image")
        configured_path = attempt.output_image_path
        runtime_candidate = (self.runtime_root / configured_path).resolve()
        if runtime_candidate.is_relative_to(self.runtime_root) and runtime_candidate.is_file():
            return runtime_candidate

        # Attempts created before runtime paths were stored relative to runtime_root
        # may still contain a project-relative path such as data/runtime/....
        legacy_candidate = (self.project_root / configured_path).resolve()
        if legacy_candidate.is_relative_to(self.runtime_root) and legacy_candidate.is_file():
            return legacy_candidate

        stage_run = self.repository.get_stage_run(stage_run_id)
        case = self.case_catalog.get_case(stage_run.case_id)
        permitted_images = {
            self._required_text(state, "image_path") for state in self._states(case)
        }
        if configured_path not in permitted_images:
            raise GameAssetError("Attempt image does not belong to its configured case")
        return self._trusted_project_file(configured_path)

    def apply_fixed_choice(
        self,
        stage_run_id: str,
        state_id: str,
        predicted_outcome: str | None,
        prediction_reason: str | None,
    ) -> GameActionRead:
        """Reveal and record one prevalidated Stage 1 offline option."""
        stage_run, case = self._stage_and_case(stage_run_id)
        if case.get("interaction_mode") != "offline_choices":
            raise GameConflictError("Fixed choices are only available in Stage 1")
        state = self._get_state(case, state_id)
        if state.get("role") != "offline_option":
            raise GameInputError("Selected state is not a player choice")
        submitted_state_ids = {
            attempt.parameters_after.get("state_id")
            for attempt in self.repository.get_attempts(stage_run_id)
            if isinstance(attempt.parameters_after, dict)
        }
        if state_id in submitted_state_ids:
            raise GameConflictError("This Stage 1 choice has already been submitted")
        offline_states = [
            candidate
            for candidate in self._states(case)
            if candidate.get("role") == "offline_option"
        ]
        fixed_test_limit = min(2, len(offline_states))
        if stage_run.attempt_count >= fixed_test_limit:
            raise GameConflictError("All Stage 1 choices have been submitted")
        top1 = self._prediction(state.get("top1"))
        initial_state = self._get_state(case, self._required_text(case, "initial_state_id"))
        top1_before = self._prediction(initial_state.get("top1")).label
        correct_label = self._required_text(case, "correct_label")
        correct = top1.label == correct_label
        restored = top1_before != correct_label and correct
        attempt = self.repository.record_attempt(
            stage_run_id,
            tool_type="apply_fixed_choice",
            parameters_before=self._parameters(initial_state),
            parameters_after={**self._parameters(state), "state_id": state_id},
            predicted_outcome=predicted_outcome,
            prediction_reason=prediction_reason,
            top1_before=top1_before,
            top1_after=top1.label,
            top5_after=[top1.model_dump()],
            classification_changed=top1.label != top1_before,
            correct_label_is_top1=correct,
            classification_restored=restored,
            output_image_path=self._required_text(state, "image_path"),
        )
        return self._action_response(case, attempt, top1, [top1])

    def reclassify(
        self,
        stage_run_id: str,
        tool_type: str,
        submitted_parameters: dict[str, float],
        predicted_outcome: str | None,
        prediction_reason: str | None,
    ) -> GameActionRead:
        """Apply a runtime Patch/FGSM state, classify it, and record trusted output."""
        return self._reclassify_runtime(
            stage_run_id,
            tool_type,
            submitted_parameters,
            predicted_outcome,
            prediction_reason,
            enforce_attempt_limit=True,
        )

    def apply_fallback(self, stage_run_id: str) -> GameActionRead:
        """Apply the configured verified repair after autonomous attempts are exhausted."""
        stage_run, case = self._stage_and_case(stage_run_id)
        maximum = case.get("max_attempts")
        if not isinstance(maximum, int) or stage_run.attempt_count < maximum:
            raise GameConflictError("Fallback is available only after maximum attempts")
        if not case.get("fallback_required"):
            raise GameConflictError("This case does not provide a fallback repair")
        fallback_parameters: dict[str, float] = {}
        for rule in self._parameter_rules(case):
            parameter = rule.get("parameter")
            fallback_value = rule.get("fallback_value")
            if not isinstance(parameter, str) or not isinstance(
                fallback_value, (int, float)
            ):
                raise GameAssetError("Fallback parameters are incomplete")
            fallback_parameters[parameter] = float(fallback_value)
        attack_type = self._required_text(case, "attack_type")
        tool_type = "adjust_patch" if attack_type == "patch" else "change_epsilon"
        self.repository.record_event(
            stage_run.session_id,
            "fallback_shown",
            {"parameters": fallback_parameters},
            stage_run_id,
        )
        return self._reclassify_runtime(
            stage_run_id,
            tool_type,
            fallback_parameters,
            "verified_fallback_will_restore",
            "System-provided verified repair after maximum autonomous attempts.",
            enforce_attempt_limit=False,
        )

    def _reclassify_runtime(
        self,
        stage_run_id: str,
        tool_type: str,
        submitted_parameters: dict[str, float],
        predicted_outcome: str | None,
        prediction_reason: str | None,
        *,
        enforce_attempt_limit: bool,
    ) -> GameActionRead:
        stage_run, case = self._stage_and_case(stage_run_id)
        if case.get("interaction_mode") == "offline_choices":
            raise GameConflictError("Stage 1 uses fixed choices, not runtime reclassification")
        if enforce_attempt_limit:
            self._check_attempt_limit(stage_run.attempt_count, case)
        attack_type = self._required_text(case, "attack_type")
        self._validate_tool(tool_type, attack_type)
        parameters = self._resolve_parameters(case, submitted_parameters)
        parameters_before = self._current_parameters(case, stage_run_id)
        if enforce_attempt_limit and stage_run.stage in {"stage3", "transfer"}:
            parameter_names = {
                self._required_text(rule, "parameter")
                for rule in self._parameter_rules(case)
            }
            unchanged = all(
                name in parameters_before
                and abs(float(parameters_before[name]) - parameters[name]) < 1e-9
                for name in parameter_names
            )
            if unchanged:
                raise GameConflictError(
                    "Change at least one repair parameter before reclassifying"
                )
        output_path = self.runtime_root / stage_run_id / f"candidate-{uuid4()}.png"

        start_time = perf_counter()
        if attack_type == "patch":
            generated_image = self._generate_patch_image(case, parameters)
        elif attack_type == "fgsm":
            generated_image = self._generate_fgsm_image(case, parameters)
        else:
            raise GameInputError(f"Unsupported attack type: {attack_type}")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        generated_image.save(output_path, format="PNG")
        try:
            with Image.open(output_path) as saved_image:
                saved_image.load()
                displayed_image = saved_image.convert("RGB").copy()
        except (UnidentifiedImageError, OSError) as error:
            raise GameAssetError(f"Could not reload runtime image: {error}") from error
        classification = self.classifier.classify(displayed_image)
        inference_duration_ms = (perf_counter() - start_time) * 1000

        top1_before = self._current_top1(case, stage_run_id)
        correct_label = self._required_text(case, "correct_label")
        correct = classification.top1.label == correct_label
        initial_label = self._prediction(
            self._get_state(case, self._required_text(case, "initial_state_id")).get(
                "top1"
            )
        ).label
        restored = initial_label != correct_label and correct
        stored_path = output_path.relative_to(self.runtime_root).as_posix()
        attempt = self.repository.record_attempt(
            stage_run_id,
            tool_type=tool_type,
            parameters_before=parameters_before,
            parameters_after=parameters,
            predicted_outcome=predicted_outcome,
            prediction_reason=prediction_reason,
            top1_before=top1_before,
            top1_after=classification.top1.label,
            top5_after=[prediction.model_dump() for prediction in classification.top5],
            classification_changed=classification.top1.label != top1_before,
            correct_label_is_top1=correct,
            classification_restored=restored,
            output_image_path=stored_path,
            inference_duration_ms=inference_duration_ms,
        )
        return self._action_response(
            case, attempt, classification.top1, classification.top5
        )

    def preview(
        self,
        stage_run_id: str,
        tool_type: str,
        submitted_parameters: dict[str, float],
    ) -> PreviewRead:
        """Generate a parameter preview without classifying or recording an Attempt."""
        _, case = self._stage_and_case(stage_run_id)
        if case.get("interaction_mode") == "offline_choices":
            raise GameConflictError("Stage 1 uses fixed choices, not runtime previews")
        attack_type = self._required_text(case, "attack_type")
        self._validate_tool(tool_type, attack_type)
        parameters = self._resolve_parameters(case, submitted_parameters)
        if attack_type == "patch":
            generated_image = self._generate_patch_image(case, parameters)
        elif attack_type == "fgsm":
            generated_image = self._generate_fgsm_image(case, parameters)
        else:
            raise GameInputError(f"Unsupported attack type: {attack_type}")
        output_path = self.runtime_root / stage_run_id / "preview.png"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        generated_image.save(output_path, format="PNG")
        return PreviewRead(
            image_url=f"/game/stage-runs/{stage_run_id}/preview/image",
            parameters=parameters,
        )

    def get_preview_image_path(self, stage_run_id: str) -> Path:
        """Return the current generated preview for an in-progress StageRun."""
        self._stage_and_case(stage_run_id)
        path = self.runtime_root / stage_run_id / "preview.png"
        if not path.is_file():
            raise GameAssetError("Preview image does not exist")
        return path

    def case_image_url(self, case_id: str, state_id: str) -> str:
        return f"/game/cases/{case_id}/states/{state_id}/image"

    def attempt_image_url(self, stage_run_id: str, attempt_number: int) -> str:
        return f"/game/stage-runs/{stage_run_id}/attempts/{attempt_number}/image"

    def _stage_and_case(self, stage_run_id: str) -> tuple[Any, dict[str, Any]]:
        stage_run = self.repository.get_stage_run(stage_run_id)
        if stage_run.completion_status != "in_progress":
            raise GameConflictError("Stage run is no longer in progress")
        case = self.case_catalog.get_case(stage_run.case_id)
        return stage_run, case

    def _current_parameters(
        self, case: dict[str, Any], stage_run_id: str
    ) -> dict[str, Any]:
        latest = self.repository.get_latest_attempt(stage_run_id)
        if latest is not None:
            return latest.parameters_after
        initial = self._get_state(case, self._required_text(case, "initial_state_id"))
        return self._parameters(initial)

    def _current_top1(self, case: dict[str, Any], stage_run_id: str) -> str:
        latest = self.repository.get_latest_attempt(stage_run_id)
        if latest is not None:
            return latest.top1_after
        initial = self._get_state(case, self._required_text(case, "initial_state_id"))
        return self._prediction(initial.get("top1")).label

    def _generate_patch_image(
        self, case: dict[str, Any], parameters: dict[str, float]
    ) -> Image.Image:
        initial = self._get_state(case, self._required_text(case, "initial_state_id"))
        source_path = self._trusted_project_file(
            self._required_text(initial, "source_image_path")
        )
        if parameters["size_fraction"] == 0:
            try:
                with Image.open(source_path) as source:
                    source.load()
                    return source.convert("RGB")
            except (UnidentifiedImageError, OSError) as error:
                raise GameAssetError(f"Could not read Patch source image: {error}") from error
        patch_path_value = self._parameters(initial).get("patch_path")
        if not isinstance(patch_path_value, str):
            raise GameAssetError("Patch case is missing patch_path")
        patch_path = self._trusted_project_file(patch_path_value)
        try:
            with Image.open(source_path) as source, Image.open(patch_path) as patch:
                source.load()
                patch.load()
                return apply_patch(
                    source,
                    patch,
                    PatchParameters(
                        position_x=parameters["position_x"],
                        position_y=parameters["position_y"],
                        size=parameters["size_fraction"],
                    ),
                ).image
        except (UnidentifiedImageError, OSError) as error:
            raise GameAssetError(f"Could not read Patch assets: {error}") from error

    def _generate_fgsm_image(
        self, case: dict[str, Any], parameters: dict[str, float]
    ) -> Image.Image:
        initial = self._get_state(case, self._required_text(case, "initial_state_id"))
        source_path = self._trusted_project_file(
            self._required_text(initial, "source_image_path")
        )
        delta_path_value = self._parameters(initial).get("delta_path")
        if not isinstance(delta_path_value, str):
            raise GameAssetError("FGSM case is missing delta_path")
        delta_path = self._trusted_project_file(delta_path_value)
        try:
            with Image.open(source_path) as source:
                source.load()
                source_tensor = image_to_pixel_tensor(source)
        except (UnidentifiedImageError, OSError) as error:
            raise GameAssetError(f"Could not read FGSM source image: {error}") from error
        try:
            bundle = load_delta_bundle(delta_path)
            adversarial, _ = reconstruct_fgsm_state(
                source_tensor,
                bundle,
                parameters["epsilon_pixels"] / 255.0,
            )
        except ValueError as error:
            raise GameAssetError(str(error)) from error
        return vision_functional.to_pil_image(adversarial.cpu()).convert("RGB")

    def _resolve_parameters(
        self, case: dict[str, Any], submitted: dict[str, float]
    ) -> dict[str, float]:
        rules = self._parameter_rules(case)
        expected = {self._required_text(rule, "parameter") for rule in rules}
        if set(submitted) != expected:
            raise GameInputError(
                f"Parameters must be exactly: {', '.join(sorted(expected))}"
            )
        resolved: dict[str, float] = {}
        for rule in rules:
            name = self._required_text(rule, "parameter")
            value = submitted[name]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise GameInputError(f"Parameter must be numeric: {name}")
            allowed = rule.get("allowed_values")
            if not isinstance(allowed, list) or not any(
                isinstance(candidate, (int, float))
                and abs(float(candidate) - float(value)) < 1e-9
                for candidate in allowed
            ):
                raise GameInputError(f"Parameter value is not allowed: {name}={value}")
            resolved[name] = float(value)
            fixed = rule.get("fixed_parameters", {})
            if isinstance(fixed, dict):
                for fixed_name, fixed_value in fixed.items():
                    if isinstance(fixed_value, (int, float)):
                        resolved[fixed_name] = float(fixed_value)
        return resolved

    def _validate_tool(self, tool_type: str, attack_type: str) -> None:
        allowed = PATCH_TOOLS if attack_type == "patch" else FGSM_TOOLS
        if tool_type not in allowed:
            raise GameInputError(
                f"Tool {tool_type} is not valid for attack type {attack_type}"
            )

    def _check_attempt_limit(self, attempt_count: int, case: dict[str, Any]) -> None:
        maximum = case.get("max_attempts")
        if case.get("interaction_mode") == "offline_choices":
            maximum = min(2, sum(state.get("role") == "offline_option" for state in self._states(case)))
        if isinstance(maximum, int) and attempt_count >= maximum:
            raise GameConflictError("Maximum attempts reached")

    def _action_response(
        self, case: dict[str, Any], attempt: Any, top1: Prediction, top5: list[Prediction]
    ) -> GameActionRead:
        maximum = case.get("max_attempts")
        if case.get("interaction_mode") == "offline_choices":
            maximum = sum(
                state.get("role") == "offline_option" for state in self._states(case)
            )
        remaining = (
            max(0, maximum - attempt.attempt_number)
            if isinstance(maximum, int)
            else None
        )
        return GameActionRead(
            attempt_number=attempt.attempt_number,
            image_url=self.attempt_image_url(
                attempt.stage_run_id, attempt.attempt_number
            ),
            top1=top1,
            top5=top5,
            parameters=attempt.parameters_after,
            classification_changed=attempt.classification_changed,
            correct_label_is_top1=attempt.correct_label_is_top1,
            classification_restored=attempt.classification_restored,
            attempts_remaining=remaining,
        )

    def _trusted_project_file(self, configured_path: str) -> Path:
        path = (self.project_root / configured_path).resolve()
        if not path.is_relative_to(self.project_root) or not path.is_file():
            raise GameAssetError(f"Trusted project file does not exist: {configured_path}")
        return path

    def _states(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        states = case.get("states")
        if not isinstance(states, list) or not all(isinstance(state, dict) for state in states):
            raise GameAssetError("Case states are invalid")
        return states

    def _get_state(self, case: dict[str, Any], state_id: str) -> dict[str, Any]:
        for state in self._states(case):
            if state.get("state_id") == state_id:
                return state
        raise GameInputError(f"State does not belong to case: {state_id}")

    def _parameter_rules(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        rules = case.get("parameter_rules", [])
        if not isinstance(rules, list) or not all(isinstance(rule, dict) for rule in rules):
            raise GameAssetError("Case parameter rules are invalid")
        return rules

    def _parameters(self, state: dict[str, Any]) -> dict[str, Any]:
        parameters = state.get("parameters", {})
        if not isinstance(parameters, dict):
            raise GameAssetError("Case state parameters are invalid")
        return parameters

    def _prediction(self, value: Any) -> Prediction:
        try:
            return Prediction.model_validate(value)
        except ValueError as error:
            raise GameAssetError("Case prediction is invalid") from error

    def _required_text(self, value: dict[str, Any], field_name: str) -> str:
        field = value.get(field_name)
        if not isinstance(field, str) or not field:
            raise GameAssetError(f"Case is missing {field_name}")
        return field
