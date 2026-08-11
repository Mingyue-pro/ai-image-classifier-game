import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import torch
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from backend.app.case_catalog import CaseCatalog
from backend.app.database import (
    create_database_engine,
    create_session_factory,
    initialize_database,
)
from backend.app.database_models import Attempt, InteractionEvent, StageRun
from backend.app.dependencies import get_game_service
from backend.app.fgsm import create_delta_bundle, save_delta_bundle
from backend.app.game_service import GameService
from backend.app.main import app
from backend.app.repositories.research_repository import ResearchRepository
from backend.app.schemas import ClassificationResponse, Prediction


class FakeClassifier:
    def __init__(self, labels: list[str]) -> None:
        self.labels = iter(labels)

    def classify(self, image: Image.Image) -> ClassificationResponse:
        assert image.mode == "RGB"
        label = next(self.labels)
        top1 = Prediction(label=label, probability=0.9, class_index=1)
        alternative = Prediction(label="alternative", probability=0.1, class_index=2)
        return ClassificationResponse(
            model_name="fake-resnet34",
            weights_name="fake",
            top1=top1,
            top5=[top1, alternative],
        )


def write_test_assets(project_root: Path) -> Path:
    source_path = project_root / "data" / "source.png"
    option_path = project_root / "data" / "option.png"
    patch_path = project_root / "data" / "patch.png"
    delta_path = project_root / "data" / "delta.pt"
    for path in (source_path, option_path, patch_path):
        path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (20, 20), "white").save(source_path)
    Image.new("RGB", (20, 20), "yellow").save(option_path)
    Image.new("RGBA", (8, 8), "red").save(patch_path)
    source_tensor = torch.full((3, 20, 20), 0.5)
    direction = torch.ones_like(source_tensor)
    save_delta_bundle(
        create_delta_bundle(source_tensor, direction, 4 / 255), delta_path
    )

    matrix_path = project_root / "case-matrix.json"
    matrix_path.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "case_id": "stage1-test-patch",
                        "stage": "stage1",
                        "subject": "banana",
                        "attack_type": "patch",
                        "interaction_mode": "offline_choices",
                        "correct_label": "banana",
                        "initial_state_id": "baseline",
                        "parameter_rules": [],
                        "states": [
                            {
                                "state_id": "baseline",
                                "role": "baseline",
                                "image_path": "data/source.png",
                                "parameters": {},
                                "top1": {
                                    "label": "banana",
                                    "probability": 0.9,
                                    "class_index": 0,
                                },
                            },
                            {
                                "state_id": "fixed-error",
                                "role": "offline_option",
                                "image_path": "data/option.png",
                                "parameters": {"size_fraction": 0.3},
                                "top1": {
                                    "label": "mailbox",
                                    "probability": 0.8,
                                    "class_index": 1,
                                },
                            },
                            {
                                "state_id": "fixed-correct",
                                "role": "offline_option",
                                "image_path": "data/source.png",
                                "parameters": {"size_fraction": 0.15},
                                "top1": {
                                    "label": "banana",
                                    "probability": 0.85,
                                    "class_index": 0,
                                },
                            },
                        ],
                    },
                    {
                        "case_id": "stage3-test-patch",
                        "stage": "stage3",
                        "subject": "traffic light",
                        "attack_type": "patch",
                        "interaction_mode": "runtime_repair",
                        "correct_label": "traffic light",
                        "initial_state_id": "patch-error",
                        "max_attempts": 3,
                        "fallback_required": True,
                        "parameter_rules": [
                            {
                                "parameter": "size_fraction",
                                "allowed_values": [0.1, 0.3],
                                "initial_value": 0.3,
                                "fallback_value": 0.1,
                                "fixed_parameters": {
                                    "position_x": 0.5,
                                    "position_y": 0.5,
                                },
                            }
                        ],
                        "states": [
                            {
                                "state_id": "patch-error",
                                "role": "initial",
                                "image_path": "data/option.png",
                                "source_image_path": "data/source.png",
                                "parameters": {
                                    "position_x": 0.5,
                                    "position_y": 0.5,
                                    "size_fraction": 0.3,
                                    "patch_path": "data/patch.png",
                                },
                                "top1": {
                                    "label": "mailbox",
                                    "probability": 0.8,
                                    "class_index": 1,
                                },
                            }
                        ],
                    },
                    {
                        "case_id": "transfer-test-fgsm",
                        "stage": "transfer",
                        "subject": "ice cream",
                        "attack_type": "fgsm",
                        "interaction_mode": "runtime_transfer",
                        "correct_label": "ice cream",
                        "initial_state_id": "fgsm-error",
                        "max_attempts": 3,
                        "parameter_rules": [
                            {
                                "parameter": "epsilon_pixels",
                                "allowed_values": [0, 4],
                                "initial_value": 4,
                            }
                        ],
                        "states": [
                            {
                                "state_id": "fgsm-error",
                                "role": "initial",
                                "image_path": "data/option.png",
                                "source_image_path": "data/source.png",
                                "parameters": {
                                    "epsilon": 4 / 255,
                                    "epsilon_pixels": 4,
                                    "delta_path": "data/delta.pt",
                                },
                                "top1": {
                                    "label": "volcano",
                                    "probability": 0.8,
                                    "class_index": 1,
                                },
                            }
                        ],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    return matrix_path


def create_stage(repository: ResearchRepository, case_id: str, stage: str, attack: str) -> str:
    participant = repository.create_participant(f"participant-{case_id}")
    research_session = repository.create_session(participant.id, "test-mvp")
    stage_run = repository.start_stage_run(
        research_session.id,
        case_id=case_id,
        stage=stage,
        attack_type=attack,
    )
    return stage_run.id


def test_game_api_hides_fixed_outcome_then_records_selected_result(
    tmp_path: Path,
) -> None:
    matrix_path = write_test_assets(tmp_path)
    database_engine = create_database_engine(f"sqlite:///{tmp_path / 'game.db'}")
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)
    with session_factory() as database_session:
        repository = ResearchRepository(database_session)
        stage_run_id = create_stage(
            repository, "stage1-test-patch", "stage1", "patch"
        )
        service = GameService(
            CaseCatalog(matrix_path),
            repository,
            FakeClassifier([]),
            tmp_path,
            tmp_path / "data" / "runtime",
        )
        app.dependency_overrides[get_game_service] = lambda: service
        try:
            with TestClient(app) as client:
                case_response = client.get("/game/cases/stage1-test-patch")
                assert case_response.status_code == 200
                option = case_response.json()["available_states"][0]
                assert set(option) == {"state_id", "role", "image_url", "parameters"}
                assert "top1" not in option
                assert client.get(option["image_url"]).status_code == 200

                action_response = client.post(
                    f"/game/stage-runs/{stage_run_id}/apply-choice",
                    json={
                        "state_id": "fixed-error",
                        "predicted_outcome": "change",
                    },
                )
                assert action_response.status_code == 201
                action = action_response.json()
                assert action["top1"]["label"] == "mailbox"
                assert action["classification_changed"] is True
                assert action["attempts_remaining"] == 1
                assert client.get(action["image_url"]).status_code == 200
                duplicate = client.post(
                    f"/game/stage-runs/{stage_run_id}/apply-choice",
                    json={"state_id": "fixed-error"},
                )
                assert duplicate.status_code == 409
                second = client.post(
                    f"/game/stage-runs/{stage_run_id}/apply-choice",
                    json={"state_id": "fixed-correct"},
                )
                assert second.status_code == 201
                assert second.json()["attempt_number"] == 2
                assert second.json()["attempts_remaining"] == 0
        finally:
            app.dependency_overrides.clear()
    database_engine.dispose()


def test_runtime_patch_and_fgsm_use_server_results_and_save_attempts(
    tmp_path: Path,
) -> None:
    matrix_path = write_test_assets(tmp_path)
    database_engine = create_database_engine(f"sqlite:///{tmp_path / 'runtime.db'}")
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)
    with session_factory() as database_session:
        repository = ResearchRepository(database_session)
        patch_stage_id = create_stage(
            repository, "stage3-test-patch", "stage3", "patch"
        )
        fgsm_stage_id = create_stage(
            repository, "transfer-test-fgsm", "transfer", "fgsm"
        )
        service = GameService(
            CaseCatalog(matrix_path),
            repository,
            FakeClassifier(["traffic light", "ice cream"]),
            tmp_path,
            tmp_path / "data" / "runtime",
        )
        app.dependency_overrides[get_game_service] = lambda: service
        try:
            with TestClient(app) as client:
                preview_response = client.post(
                    f"/game/stage-runs/{patch_stage_id}/preview",
                    json={
                        "tool_type": "resize_patch",
                        "parameters": {"size_fraction": 0.1},
                    },
                )
                assert preview_response.status_code == 200
                assert preview_response.json()["parameters"] == {
                    "size_fraction": 0.1,
                    "position_x": 0.5,
                    "position_y": 0.5,
                }
                assert client.get(preview_response.json()["image_url"]).status_code == 200
                assert database_session.scalars(select(Attempt)).all() == []

                patch_response = client.post(
                    f"/game/stage-runs/{patch_stage_id}/reclassify",
                    json={
                        "tool_type": "resize_patch",
                        "parameters": {"size_fraction": 0.1},
                        "prediction_reason": "A smaller patch should reveal the object.",
                    },
                )
                assert patch_response.status_code == 201
                assert patch_response.json()["classification_restored"] is True
                assert patch_response.json()["parameters"] == {
                    "size_fraction": 0.1,
                    "position_x": 0.5,
                    "position_y": 0.5,
                }
                assert client.get(patch_response.json()["image_url"]).status_code == 200

                fgsm_response = client.post(
                    f"/game/stage-runs/{fgsm_stage_id}/reclassify",
                    json={
                        "tool_type": "remove_perturbation",
                        "parameters": {"epsilon_pixels": 0},
                    },
                )
                assert fgsm_response.status_code == 201
                assert fgsm_response.json()["top1"]["label"] == "ice cream"
                assert fgsm_response.json()["classification_restored"] is True

                invalid = client.post(
                    f"/game/stage-runs/{patch_stage_id}/reclassify",
                    json={
                        "tool_type": "resize_patch",
                        "parameters": {"size_fraction": 0.2},
                    },
                )
                assert invalid.status_code == 422

            attempts = database_session.scalars(select(Attempt)).all()
            assert len(attempts) == 2
            assert all(attempt.output_image_path for attempt in attempts)
            assert attempts[0].top1_after == "traffic light"
        finally:
            app.dependency_overrides.clear()
    database_engine.dispose()


def test_verified_fallback_is_available_only_after_maximum_attempts(
    tmp_path: Path,
) -> None:
    matrix_path = write_test_assets(tmp_path)
    database_engine = create_database_engine(f"sqlite:///{tmp_path / 'fallback.db'}")
    initialize_database(database_engine)
    session_factory = create_session_factory(database_engine)
    with session_factory() as database_session:
        repository = ResearchRepository(database_session)
        stage_run_id = create_stage(
            repository, "stage3-test-patch", "stage3", "patch"
        )
        service = GameService(
            CaseCatalog(matrix_path),
            repository,
            FakeClassifier(["mailbox", "mailbox", "mailbox", "traffic light"]),
            tmp_path,
            tmp_path / "data" / "runtime",
        )
        app.dependency_overrides[get_game_service] = lambda: service
        try:
            with TestClient(app) as client:
                early = client.post(
                    f"/game/stage-runs/{stage_run_id}/apply-fallback", json={}
                )
                assert early.status_code == 409

                for attempt_number in range(1, 4):
                    response = client.post(
                        f"/game/stage-runs/{stage_run_id}/reclassify",
                        json={
                            "tool_type": "resize_patch",
                            "parameters": {"size_fraction": 0.3},
                            "predicted_outcome": "still_incorrect",
                            "prediction_reason": "Testing another repair idea.",
                        },
                    )
                    assert response.status_code == 201
                    assert response.json()["attempt_number"] == attempt_number
                    assert response.json()["classification_restored"] is False

                fallback = client.post(
                    f"/game/stage-runs/{stage_run_id}/apply-fallback", json={}
                )
                assert fallback.status_code == 201
                assert fallback.json()["attempt_number"] == 4
                assert fallback.json()["parameters"]["size_fraction"] == 0.1
                assert fallback.json()["classification_restored"] is True

            stage_run = database_session.get(StageRun, stage_run_id)
            assert stage_run is not None
            assert stage_run.fallback_shown is True
            assert stage_run.success is True
            assert stage_run.attempt_count == 4
            events = database_session.scalars(select(InteractionEvent)).all()
            assert [event.event_type for event in events] == ["fallback_shown"]
        finally:
            app.dependency_overrides.clear()
    database_engine.dispose()
