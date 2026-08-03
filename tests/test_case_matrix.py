import csv
import json
from pathlib import Path

import pytest

from backend.app.case_matrix import (
    build_case_matrix,
    write_case_matrix_csv,
    write_case_matrix_json,
)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def make_patch_project(tmp_path: Path) -> Path:
    source_path = "data/source.png"
    state_specs = [
        ("initial", "initial_correct", 0.10, "strawberry"),
        ("correct", "parameter_option_correct", 0.15, "strawberry"),
        ("error", "parameter_option_error", 0.20, "toaster"),
    ]
    (tmp_path / source_path).parent.mkdir(parents=True)
    (tmp_path / source_path).touch()

    image_records = []
    states = []
    for name, role, size, label in state_specs:
        image_path = f"data/{name}.png"
        metadata_path = f"data/{name}.json"
        (tmp_path / image_path).touch()
        write_json(
            tmp_path / metadata_path,
            {
                "manipulation_type": "adversarial_patch",
                "source_path": source_path,
                "output_image_path": image_path,
                "patch_path": "data/patch.png",
                "position": {"x": 0.5, "y": 0.5},
                "size_fraction": size,
            },
        )
        image_records.append(
            {
                "source_path": image_path,
                "status": "success",
                "top1": {
                    "label": label,
                    "probability": 0.8,
                    "class_index": 1,
                },
            }
        )
        states.append(
            {
                "state_id": f"state-{name}",
                "role": role,
                "requiredness": "required",
                "initial_display": name == "initial",
                "include_in_matrix": True,
                "source_image_path": source_path,
                "image_path": image_path,
                "metadata_path": metadata_path,
                "classification_path": "data/classifications.json",
                "expected_top1": label,
                "expected_classification_changed": label != "strawberry",
            }
        )

    (tmp_path / "data/patch.png").touch()
    write_json(tmp_path / "data/classifications.json", {"images": image_records})
    selection_path = tmp_path / "config/selection.json"
    write_json(
        selection_path,
        {
            "schema_version": "1.0",
            "cases": [
                {
                    "case_id": "stage2-strawberry-patch",
                    "stage": "stage2",
                    "subject": "strawberry",
                    "attack_type": "patch",
                    "interaction_mode": "runtime_parameter_choice",
                    "correct_label": "strawberry",
                    "initial_state_id": "state-initial",
                    "max_attempts": None,
                    "success_condition": "compare_prediction_with_result",
                    "fallback_required": False,
                    "parameter_rules": [
                        {
                            "parameter": "size_fraction",
                            "control_type": "select",
                            "allowed_values": [0.1, 0.15, 0.2],
                        }
                    ],
                    "states": states,
                }
            ],
        },
    )
    return selection_path


def test_build_case_matrix_extracts_predictions_and_patch_parameters(
    tmp_path: Path,
) -> None:
    selection_path = make_patch_project(tmp_path)

    matrix = build_case_matrix(selection_path, tmp_path)

    assert matrix["summary"] == {"case_count": 1, "state_count": 3}
    case = matrix["cases"][0]
    assert case["initial_state_id"] == "state-initial"
    assert [state["classification_changed"] for state in case["states"]] == [
        False,
        False,
        True,
    ]
    assert case["states"][2]["parameters"]["size_fraction"] == 0.2


def test_build_case_matrix_rejects_expected_prediction_mismatch(
    tmp_path: Path,
) -> None:
    selection_path = make_patch_project(tmp_path)
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    selection["cases"][0]["states"][0]["expected_top1"] = "banana"
    write_json(selection_path, selection)

    with pytest.raises(ValueError, match="Top-1 mismatch"):
        build_case_matrix(selection_path, tmp_path)


def test_build_case_matrix_rejects_missing_required_stage2_role(
    tmp_path: Path,
) -> None:
    selection_path = make_patch_project(tmp_path)
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    selection["cases"][0]["states"][2]["include_in_matrix"] = False
    write_json(selection_path, selection)

    with pytest.raises(ValueError, match="missing parameter comparison states"):
        build_case_matrix(selection_path, tmp_path)


def test_build_case_matrix_extracts_fgsm_states_and_fallback(
    tmp_path: Path,
) -> None:
    source_path = "data/traffic-light.png"
    attacked_path = "data/epsilon-004.png"
    (tmp_path / "data").mkdir()
    (tmp_path / source_path).touch()
    (tmp_path / attacked_path).touch()
    write_json(
        tmp_path / "data/fgsm.json",
        {
            "manipulation_type": "untargeted_fgsm",
            "source_path": source_path,
            "delta_path": "data/traffic-light-delta.pt",
            "cases": [
                {
                    "epsilon": 4 / 255,
                    "epsilon_pixels": 4,
                    "output_image_path": attacked_path,
                    "top1": {
                        "label": "shopping cart",
                        "probability": 0.7,
                        "class_index": 791,
                    },
                },
                {
                    "epsilon": 0,
                    "epsilon_pixels": 0,
                    "output_image_path": "data/epsilon-000.png",
                    "top1": {
                        "label": "traffic light",
                        "probability": 0.9,
                        "class_index": 920,
                    },
                },
            ],
        },
    )
    selection_path = tmp_path / "config/selection.json"
    write_json(
        selection_path,
        {
            "schema_version": "1.0",
            "cases": [
                {
                    "case_id": "stage3-trafficlight-pixel",
                    "stage": "stage3",
                    "subject": "traffic light",
                    "attack_type": "fgsm",
                    "interaction_mode": "runtime_repair",
                    "correct_label": "traffic light",
                    "initial_state_id": "state-error",
                    "max_attempts": 3,
                    "success_condition": "restore_correct_or_show_fallback",
                    "fallback_required": True,
                    "parameter_rules": [
                        {
                            "parameter": "epsilon_pixels",
                            "control_type": "select",
                            "allowed_values": [0, 1, 2, 4],
                        }
                    ],
                    "states": [
                        {
                            "state_id": "state-error",
                            "role": "initial_error",
                            "requiredness": "required",
                            "initial_display": True,
                            "include_in_matrix": True,
                            "source_image_path": source_path,
                            "image_path": attacked_path,
                            "classification_path": "data/fgsm.json",
                            "epsilon_pixels": 4,
                            "expected_top1": "shopping cart",
                            "expected_classification_changed": True,
                        },
                        {
                            "state_id": "state-fallback",
                            "role": "fallback_correct",
                            "requiredness": "required",
                            "initial_display": False,
                            "include_in_matrix": True,
                            "source_image_path": source_path,
                            "image_path": source_path,
                            "classification_path": "data/fgsm.json",
                            "epsilon_pixels": 0,
                            "expected_top1": "traffic light",
                            "expected_classification_changed": False,
                        },
                    ],
                }
            ],
        },
    )

    matrix = build_case_matrix(selection_path, tmp_path)

    states = matrix["cases"][0]["states"]
    assert states[0]["parameters"]["epsilon_pixels"] == 4
    assert states[0]["classification_changed"] is True
    assert states[1]["role"] == "fallback_correct"
    assert states[1]["correct_label_is_top1"] is True


def test_matrix_writers_create_nested_json_and_flat_csv(tmp_path: Path) -> None:
    matrix = build_case_matrix(make_patch_project(tmp_path), tmp_path)
    json_path = tmp_path / "output/case-matrix.json"
    csv_path = tmp_path / "output/case-matrix.csv"

    write_case_matrix_json(matrix, json_path)
    write_case_matrix_csv(matrix, csv_path)

    saved_json = json.loads(json_path.read_text(encoding="utf-8"))
    with csv_path.open(encoding="utf-8", newline="") as input_file:
        rows = list(csv.DictReader(input_file))
    assert saved_json["summary"]["state_count"] == 3
    assert len(rows) == 3
    assert rows[2]["top1_label"] == "toaster"
    assert rows[2]["classification_changed"] == "True"
