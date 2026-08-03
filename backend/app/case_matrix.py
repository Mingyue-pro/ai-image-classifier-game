"""Build and validate the selected educational case matrix."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "1.0"
SUPPORTED_STAGES = {"stage1", "stage2", "stage3", "transfer"}
SUPPORTED_ATTACK_TYPES = {"patch", "fgsm"}


@dataclass(frozen=True)
class SelectedState:
    """One selected or reference state declared in the input configuration."""

    state_id: str
    role: str
    requiredness: str
    initial_display: bool
    include_in_matrix: bool
    source_image_path: str
    image_path: str
    classification_path: str
    metadata_path: str | None = None
    epsilon_pixels: float | None = None
    expected_top1: str | None = None
    expected_classification_changed: bool | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> SelectedState:
        """Validate and convert one state configuration dictionary."""
        required_fields = {
            "state_id",
            "role",
            "requiredness",
            "initial_display",
            "include_in_matrix",
            "source_image_path",
            "image_path",
            "classification_path",
        }
        missing_fields = sorted(required_fields - value.keys())
        if missing_fields:
            raise ValueError(
                f"State is missing required fields: {', '.join(missing_fields)}"
            )

        epsilon_pixels = value.get("epsilon_pixels")
        if epsilon_pixels is not None and not isinstance(epsilon_pixels, (int, float)):
            raise ValueError("epsilon_pixels must be a number")

        return cls(
            state_id=_required_text(value, "state_id"),
            role=_required_text(value, "role"),
            requiredness=_required_text(value, "requiredness"),
            initial_display=_required_boolean(value, "initial_display"),
            include_in_matrix=_required_boolean(value, "include_in_matrix"),
            source_image_path=_required_text(value, "source_image_path"),
            image_path=_required_text(value, "image_path"),
            classification_path=_required_text(value, "classification_path"),
            metadata_path=_optional_text(value.get("metadata_path")),
            epsilon_pixels=float(epsilon_pixels)
            if epsilon_pixels is not None
            else None,
            expected_top1=_optional_text(value.get("expected_top1")),
            expected_classification_changed=value.get(
                "expected_classification_changed"
            ),
        )


@dataclass(frozen=True)
class SelectedCase:
    """One case and its selected states declared in the input configuration."""

    case_id: str
    stage: str
    subject: str
    attack_type: str
    interaction_mode: str
    correct_label: str
    initial_state_id: str
    success_condition: str
    fallback_required: bool
    max_attempts: int | None
    states: tuple[SelectedState, ...]
    parameter_rules: tuple[dict[str, Any], ...]

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> SelectedCase:
        """Validate and convert one case configuration dictionary."""
        stage = _required_text(value, "stage")
        attack_type = _required_text(value, "attack_type")
        if stage not in SUPPORTED_STAGES:
            raise ValueError(f"Unsupported stage: {stage}")
        if attack_type not in SUPPORTED_ATTACK_TYPES:
            raise ValueError(f"Unsupported attack type: {attack_type}")

        raw_states = value.get("states")
        if not isinstance(raw_states, list) or not raw_states:
            raise ValueError("Each case must contain at least one state")
        states = tuple(SelectedState.from_dict(state) for state in raw_states)
        state_ids = [state.state_id for state in states]
        if len(state_ids) != len(set(state_ids)):
            raise ValueError(f"Case contains duplicate state_id values: {value.get('case_id')}")

        max_attempts = value.get("max_attempts")
        if max_attempts is not None:
            if not isinstance(max_attempts, int) or max_attempts <= 0:
                raise ValueError("max_attempts must be a positive integer or null")

        parameter_rules = value.get("parameter_rules", [])
        if not isinstance(parameter_rules, list):
            raise ValueError("parameter_rules must be a list")

        return cls(
            case_id=_required_text(value, "case_id"),
            stage=stage,
            subject=_required_text(value, "subject"),
            attack_type=attack_type,
            interaction_mode=_required_text(value, "interaction_mode"),
            correct_label=_required_text(value, "correct_label"),
            initial_state_id=_required_text(value, "initial_state_id"),
            success_condition=_required_text(value, "success_condition"),
            fallback_required=_required_boolean(value, "fallback_required"),
            max_attempts=max_attempts,
            states=states,
            parameter_rules=tuple(parameter_rules),
        )


def _required_text(value: dict[str, Any], field_name: str) -> str:
    field_value = value.get(field_name)
    if not isinstance(field_value, str) or not field_value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    return field_value.strip()


def _optional_text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("Optional path and label values must be strings")
    return value.strip()


def _required_boolean(value: dict[str, Any], field_name: str) -> bool:
    field_value = value.get(field_name)
    if not isinstance(field_value, bool):
        raise ValueError(f"{field_name} must be true or false")
    return field_value


def _read_json(project_root: Path, configured_path: str) -> dict[str, Any]:
    path = _resolve_project_path(project_root, configured_path)
    if not path.exists():
        raise ValueError(f"Required JSON file does not exist: {configured_path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read JSON file {configured_path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {configured_path}")
    return value


def _resolve_project_path(project_root: Path, configured_path: str) -> Path:
    path = Path(configured_path)
    return path if path.is_absolute() else project_root / path


def _require_file(project_root: Path, configured_path: str) -> None:
    if not _resolve_project_path(project_root, configured_path).is_file():
        raise ValueError(f"Required file does not exist: {configured_path}")


def _find_batch_record(
    classification: dict[str, Any], image_path: str
) -> dict[str, Any]:
    image_records = classification.get("images")
    if not isinstance(image_records, list):
        raise ValueError("Batch classification JSON must contain an images list")
    for record in image_records:
        if (
            isinstance(record, dict)
            and record.get("source_path") == image_path
            and record.get("status") == "success"
        ):
            return record
    raise ValueError(f"Classification result not found for image: {image_path}")


def _find_fgsm_case(
    result: dict[str, Any], epsilon_pixels: float
) -> dict[str, Any]:
    cases = result.get("cases")
    if not isinstance(cases, list):
        raise ValueError("FGSM result JSON must contain a cases list")
    for case in cases:
        if not isinstance(case, dict):
            continue
        value = case.get("epsilon_pixels")
        if isinstance(value, (int, float)) and abs(float(value) - epsilon_pixels) < 1e-9:
            return case
    raise ValueError(f"FGSM state not found for epsilon_pixels={epsilon_pixels:g}")


def _build_patch_state(
    state: SelectedState,
    correct_label: str,
    project_root: Path,
) -> dict[str, Any]:
    _require_file(project_root, state.source_image_path)
    _require_file(project_root, state.image_path)
    classification = _read_json(project_root, state.classification_path)
    parameters: dict[str, Any] = {}

    if state.metadata_path is not None:
        metadata = _read_json(project_root, state.metadata_path)
        if metadata.get("manipulation_type") != "adversarial_patch":
            raise ValueError(
                f"Patch metadata has unexpected manipulation_type: {state.state_id}"
            )
        if metadata.get("source_path") != state.source_image_path:
            raise ValueError(f"Patch source path mismatch: {state.state_id}")
        if metadata.get("output_image_path") != state.image_path:
            raise ValueError(f"Patch output image path mismatch: {state.state_id}")
        position = metadata.get("position")
        if not isinstance(position, dict):
            raise ValueError(f"Patch metadata is missing position: {state.state_id}")
        parameters = {
            "position_x": position.get("x"),
            "position_y": position.get("y"),
            "size_fraction": metadata.get("size_fraction"),
            "patch_path": metadata.get("patch_path"),
        }

    prediction_record = _find_batch_record(classification, state.image_path)
    return _complete_state(state, correct_label, parameters, prediction_record.get("top1"))


def _build_fgsm_state(
    state: SelectedState,
    correct_label: str,
    project_root: Path,
) -> dict[str, Any]:
    _require_file(project_root, state.source_image_path)
    _require_file(project_root, state.image_path)
    result = _read_json(project_root, state.classification_path)
    if result.get("manipulation_type") != "untargeted_fgsm":
        raise ValueError(f"FGSM result has unexpected manipulation_type: {state.state_id}")
    if result.get("source_path") != state.source_image_path:
        raise ValueError(f"FGSM source path mismatch: {state.state_id}")
    if state.epsilon_pixels is None:
        raise ValueError(f"FGSM state is missing epsilon_pixels: {state.state_id}")

    fgsm_case = _find_fgsm_case(result, state.epsilon_pixels)
    generated_image_path = fgsm_case.get("output_image_path")
    if state.epsilon_pixels != 0 and generated_image_path != state.image_path:
        raise ValueError(f"FGSM output image path mismatch: {state.state_id}")
    parameters = {
        "epsilon": fgsm_case.get("epsilon"),
        "epsilon_pixels": fgsm_case.get("epsilon_pixels"),
        "delta_path": result.get("delta_path"),
    }
    return _complete_state(state, correct_label, parameters, fgsm_case.get("top1"))


def _complete_state(
    state: SelectedState,
    correct_label: str,
    parameters: dict[str, Any],
    top1: Any,
) -> dict[str, Any]:
    if not isinstance(top1, dict) or not isinstance(top1.get("label"), str):
        raise ValueError(f"State is missing a valid Top-1 result: {state.state_id}")
    top1_label = top1["label"]
    classification_changed = top1_label != correct_label
    if state.expected_top1 is not None and state.expected_top1 != top1_label:
        raise ValueError(
            f"Top-1 mismatch for {state.state_id}: expected "
            f"{state.expected_top1}, got {top1_label}"
        )
    if (
        state.expected_classification_changed is not None
        and state.expected_classification_changed != classification_changed
    ):
        raise ValueError(
            f"classification_changed mismatch for {state.state_id}: expected "
            f"{state.expected_classification_changed}, got {classification_changed}"
        )

    return {
        "state_id": state.state_id,
        "role": state.role,
        "requiredness": state.requiredness,
        "initial_display": state.initial_display,
        "source_image_path": state.source_image_path,
        "image_path": state.image_path,
        "metadata_path": state.metadata_path,
        "classification_path": state.classification_path,
        "parameters": parameters,
        "top1": top1,
        "classification_changed": classification_changed,
        "correct_label_is_top1": not classification_changed,
    }


def _validate_parameter_rules(case: SelectedCase) -> None:
    if case.stage == "stage1" and case.parameter_rules:
        raise ValueError(f"Stage 1 case must not have runtime parameters: {case.case_id}")
    if case.stage != "stage1" and not case.parameter_rules:
        raise ValueError(f"Runtime case must define parameter rules: {case.case_id}")

    for rule in case.parameter_rules:
        if not isinstance(rule, dict):
            raise ValueError(f"Parameter rule must be an object: {case.case_id}")
        _required_text(rule, "parameter")
        _required_text(rule, "control_type")
        allowed_values = rule.get("allowed_values")
        if not isinstance(allowed_values, list) or not allowed_values:
            raise ValueError(
                f"Parameter rule must have allowed_values: {case.case_id}"
            )
        if not all(isinstance(value, (int, float)) for value in allowed_values):
            raise ValueError(
                f"Parameter allowed_values must be numeric: {case.case_id}"
            )


def _validate_built_case(case: SelectedCase, states: list[dict[str, Any]]) -> None:
    roles = {state["role"] for state in states}
    state_ids = {state["state_id"] for state in states}
    if case.initial_state_id not in state_ids:
        raise ValueError(
            f"initial_state_id is not included in the matrix: {case.case_id}"
        )

    if case.stage == "stage1":
        if not {"baseline", "offline_option"}.issubset(roles):
            raise ValueError(f"Stage 1 requires baseline and offline options: {case.case_id}")
        offline_states = [state for state in states if state["role"] == "offline_option"]
        changed_values = {state["classification_changed"] for state in offline_states}
        if changed_values != {False, True}:
            raise ValueError(
                f"Stage 1 needs unchanged and changed attack outcomes: {case.case_id}"
            )
    elif case.stage == "stage2":
        required_roles = {
            "initial_correct",
            "parameter_option_correct",
            "parameter_option_error",
        }
        if not required_roles.issubset(roles):
            raise ValueError(
                f"Stage 2 is missing parameter comparison states: {case.case_id}"
            )
    else:
        if not {"initial_error", "fallback_correct"}.issubset(roles):
            raise ValueError(
                f"{case.stage} requires initial_error and fallback_correct: "
                f"{case.case_id}"
            )
        if case.max_attempts is None:
            raise ValueError(f"Runtime repair case needs max_attempts: {case.case_id}")

    if case.fallback_required and "fallback_correct" not in roles:
        raise ValueError(f"Required fallback is missing: {case.case_id}")
    _validate_parameter_rules(case)


def build_case_matrix(
    selection_path: Path,
    project_root: Path | None = None,
) -> dict[str, Any]:
    """Build a validated matrix from a selected-case configuration."""
    root = (project_root or Path.cwd()).resolve()
    selection = _read_json(root, selection_path.as_posix())
    if selection.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported selection schema_version: {selection.get('schema_version')}"
        )
    raw_cases = selection.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("Selection must contain a non-empty cases list")

    selected_cases = [SelectedCase.from_dict(value) for value in raw_cases]
    case_ids = [case.case_id for case in selected_cases]
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("Selection contains duplicate case_id values")

    built_cases = []
    selected_state_count = 0
    for case in selected_cases:
        built_states = []
        for state in case.states:
            if not state.include_in_matrix:
                continue
            if case.attack_type == "patch":
                built_state = _build_patch_state(state, case.correct_label, root)
            else:
                built_state = _build_fgsm_state(state, case.correct_label, root)
            built_states.append(built_state)
        _validate_built_case(case, built_states)
        selected_state_count += len(built_states)
        built_cases.append(
            {
                "case_id": case.case_id,
                "stage": case.stage,
                "subject": case.subject,
                "attack_type": case.attack_type,
                "interaction_mode": case.interaction_mode,
                "correct_label": case.correct_label,
                "initial_state_id": case.initial_state_id,
                "max_attempts": case.max_attempts,
                "success_condition": case.success_condition,
                "fallback_required": case.fallback_required,
                "parameter_rules": list(case.parameter_rules),
                "states": built_states,
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "source_selection_path": selection_path.as_posix(),
        "summary": {
            "case_count": len(built_cases),
            "state_count": selected_state_count,
        },
        "cases": built_cases,
    }


def write_case_matrix_json(matrix: dict[str, Any], output_path: Path) -> None:
    """Write the complete nested case matrix as UTF-8 JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(matrix, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def write_case_matrix_csv(matrix: dict[str, Any], output_path: Path) -> None:
    """Write one flat CSV row per included case state."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "case_id",
        "stage",
        "subject",
        "attack_type",
        "interaction_mode",
        "correct_label",
        "max_attempts",
        "state_id",
        "role",
        "initial_display",
        "source_image_path",
        "image_path",
        "metadata_path",
        "classification_path",
        "parameters",
        "top1_label",
        "top1_probability",
        "top1_class_index",
        "classification_changed",
        "correct_label_is_top1",
    ]
    with output_path.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        writer.writeheader()
        for case in matrix["cases"]:
            for state in case["states"]:
                top1 = state["top1"]
                writer.writerow(
                    {
                        "case_id": case["case_id"],
                        "stage": case["stage"],
                        "subject": case["subject"],
                        "attack_type": case["attack_type"],
                        "interaction_mode": case["interaction_mode"],
                        "correct_label": case["correct_label"],
                        "max_attempts": case["max_attempts"],
                        "state_id": state["state_id"],
                        "role": state["role"],
                        "initial_display": state["initial_display"],
                        "source_image_path": state["source_image_path"],
                        "image_path": state["image_path"],
                        "metadata_path": state["metadata_path"],
                        "classification_path": state["classification_path"],
                        "parameters": json.dumps(
                            state["parameters"], ensure_ascii=False, sort_keys=True
                        ),
                        "top1_label": top1["label"],
                        "top1_probability": top1.get("probability"),
                        "top1_class_index": top1.get("class_index"),
                        "classification_changed": state["classification_changed"],
                        "correct_label_is_top1": state["correct_label_is_top1"],
                    }
                )
