from __future__ import annotations

from collections.abc import Iterator
import csv
from io import StringIO
from pathlib import Path

import torch
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from backend.app.complex_transfer import ComplexTransferAssets
from backend.app.complex_transfer_service import ComplexTransferService
from backend.app.database import create_database_engine, create_session_factory, initialize_database
from backend.app.database_models import Attempt, Response, StageRun
from backend.app.dependencies import get_complex_transfer_service
from backend.app.fgsm import create_delta_bundle, save_delta_bundle
from backend.app.export_service import ResearchExportService
from backend.app.main import app
from backend.app.repositories.research_repository import ResearchRepository
from backend.app.schemas import ClassificationResponse, Prediction


class FakeClassifier:
    def __init__(self, labels: list[str]) -> None:
        self.labels: Iterator[str] = iter(labels)
        self.calls = 0

    def classify(self, image: Image.Image) -> ClassificationResponse:
        self.calls += 1
        label = next(self.labels)
        top1 = Prediction(label=label, probability=0.8, class_index=1)
        return ClassificationResponse(model_name="resnet34", weights_name="fake", top1=top1, top5=[top1])


def test_formal_complex_transfer_api_persists_state_and_attempts(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    patch_path = tmp_path / "patch.png"
    delta_path = tmp_path / "delta.pt"
    source = Image.new("RGB", (32, 32), (30, 90, 150))
    source.save(source_path)
    Image.new("RGBA", (8, 8), (230, 30, 10, 255)).save(patch_path)
    tensor = torch.full((3, 32, 32), 0.5)
    save_delta_bundle(create_delta_bundle(tensor, torch.ones_like(tensor), 4 / 255), delta_path)
    engine = create_database_engine(f"sqlite:///{tmp_path / 'complex.db'}")
    initialize_database(engine)
    factory = create_session_factory(engine)
    with factory() as database_session:
        repository = ResearchRepository(database_session)
        participant = repository.create_participant("complex-participant")
        session = repository.create_session(participant.id, "v2")
        classifier = FakeClassifier(["toaster", "toaster", "ice cream"])
        service = ComplexTransferService(repository, classifier, tmp_path, tmp_path / "runtime")
        service.assets = ComplexTransferAssets(source_path, delta_path, patch_path)
        app.dependency_overrides[get_complex_transfer_service] = lambda: service
        try:
            with TestClient(app) as client:
                initialized = client.post(f"/game/sessions/{session.id}/complex-transfer")
                assert initialized.status_code == 201
                run = initialized.json()
                assert run["current_top1"]["label"] == "toaster"
                assert run["attempt_index"] == 0
                assert run["remaining_attempts"] == 5
                assert run["finished"] is False
                assert run["attempts"] == []
                assert run["current_parameters"] == {
                    "patch": {"size_fraction": 0.3, "position_x": 0.6, "position_y": 0.2},
                    "pixel_strength": 4.0,
                    "blur_level": "high",
                }
                assert client.get(run["image_url"]).status_code == 200
                assert run["original_image_url"].endswith("/original/image")
                assert client.get(run["original_image_url"]).status_code == 200
                stage_run_id = run["stage_run_id"]
                patch_after = {
                    "patch": {"size_fraction": 0.1, "position_x": 0.6, "position_y": 0.2},
                    "pixel_strength": 4,
                    "blur_level": "high",
                }
                preview = client.post(f"/game/complex-transfer-runs/{stage_run_id}/preview", json={"selected_factor": "patch", "parameters": patch_after})
                assert preview.status_code == 200
                assert client.get(preview.json()["image_url"]).status_code == 200
                assert database_session.scalars(select(Attempt)).all() == []
                assert classifier.calls == 1

                unchanged = client.post(f"/game/complex-transfer-runs/{stage_run_id}/reclassify", json={"selected_factor": "patch", "prediction": "stay_same", "parameters": run["current_parameters"]})
                assert unchanged.status_code == 409
                assert unchanged.json()["detail"] == "Please make a change before reclassifying."
                invalid = client.post(f"/game/complex-transfer-runs/{stage_run_id}/reclassify", json={"selected_factor": "patch", "prediction": "stay_same", "parameters": patch_after | {"pixel_strength": 1}})
                assert invalid.status_code == 409

                first = client.post(f"/game/complex-transfer-runs/{stage_run_id}/reclassify", json={"selected_factor": "patch", "prediction": "change_uncertain", "prediction_reason": "Visible region may matter.", "parameters": patch_after, "after_classification": {"label": "ice cream"}})
                assert first.status_code == 201
                assert first.json()["after_top1"]["label"] == "toaster"
                assert first.json()["remaining_attempts"] == 4
                pixel_after = patch_after | {"pixel_strength": 0}
                second = client.post(f"/game/complex-transfer-runs/{stage_run_id}/reclassify", json={"selected_factor": "pixel", "prediction": "restore_correct", "parameters": pixel_after})
                assert second.status_code == 201
                assert second.json()["after_parameters"]["patch"]["size_fraction"] == 0.1
                assert second.json()["classification_restored"] is True
                resumed = client.post(f"/game/sessions/{session.id}/complex-transfer")
                assert resumed.status_code == 201
                summary = resumed.json()
                assert summary["stage_run_id"] == stage_run_id
                assert summary["finished"] is True
                assert summary["exhausted"] is False
                assert summary["initial_top1_label"] == "toaster"
                assert [item["attempt_number"] for item in summary["attempts"]] == [1, 2]
                assert summary["attempts"][0]["selected_factor"] == "patch"
                assert summary["attempts"][1]["selected_factor"] == "pixel"
                reflection_before = client.get(
                    f"/game/complex-transfer-runs/{stage_run_id}/reflection"
                )
                assert reflection_before.status_code == 200
                assert reflection_before.json()["completed"] is False
                blank = client.post(
                    f"/game/complex-transfer-runs/{stage_run_id}/reflection",
                    json={"learning_reflection": "   ", "new_error_strategy": "test"},
                )
                assert blank.status_code == 409
                answers = {
                    "learning_reflection": "Different attempts produced different evidence.",
                    "new_error_strategy": "I would investigate and use each result to decide what to try next.",
                }
                reflection = client.post(
                    f"/game/complex-transfer-runs/{stage_run_id}/reflection",
                    json=answers,
                )
                assert reflection.status_code == 200
                assert reflection.json() == {
                    "stage_run_id": stage_run_id,
                    "completed": True,
                    **answers,
                }
                repeated = client.post(
                    f"/game/complex-transfer-runs/{stage_run_id}/reflection",
                    json=answers,
                )
                assert repeated.status_code == 200

            attempts = list(database_session.scalars(select(Attempt).order_by(Attempt.attempt_number)))
            assert len(attempts) == 2
            assert attempts[0].tool_type == "complex_transfer_patch"
            assert attempts[0].prediction_reason == "Visible region may matter."
            assert attempts[1].parameters_before["patch_size_fraction"] == 0.1
            assert attempts[1].parameters_after["epsilon_pixels"] == 0
            stage = database_session.scalar(select(StageRun).where(StageRun.id == stage_run_id))
            assert stage is not None and stage.attempt_count == 2
            assert stage.completion_status == "completed"
            assert stage.success is True
            responses = list(
                database_session.scalars(
                    select(Response).where(Response.stage_run_id == stage_run_id)
                )
            )
            assert [response.question_key for response in responses] == [
                "complex_transfer_learning_reflection",
                "complex_transfer_new_error_strategy",
            ]
            assert all(response.session_id == session.id for response in responses)
            assert stage.attempt_count == 2
            assert stage.classification_restored is True
            export_service = ResearchExportService(repository)
            exported = export_service.build_json(session.id)
            exported_stage = next(
                item
                for item in exported["stage_runs"]
                if item["id"] == stage_run_id
            )
            assert exported["participant"]["id"] == participant.id
            assert exported_stage["complex_transfer_outcome"]["completed"] is True
            assert exported_stage["complex_transfer_outcome"]["attempts_used"] == 2
            assert exported_stage["complex_transfer_outcome"]["operational_success"] is True
            assert exported_stage["complex_transfer_outcome"]["autonomous_success"] is True
            assert exported_stage["complex_transfer_outcome"]["fallback_used"] is False
            assert exported_stage["complex_transfer_outcome"]["reflection_completed"] is True
            assert exported_stage["complex_transfer_outcome"]["duration_seconds"] >= 0
            assert [item["selected_factor"] for item in exported_stage["attempts"]] == [
                "Patch",
                "Pixel",
            ]
            assert all(
                item["fallback_used"] is False for item in exported_stage["attempts"]
            )
            assert exported_stage["attempts"][0]["parameters_before"] == {
                "patch_enabled": True,
                "patch_size_fraction": 0.3,
                "patch_position_x": 0.6,
                "patch_position_y": 0.2,
                "epsilon_pixels": 4.0,
                "blur_level": "high",
                "blur_radius": 16.0,
            }
            assert exported_stage["attempts"][0]["parameters_after"]["patch_enabled"] is True
            assert {
                response["question_key"] for response in exported_stage["responses"]
            } == {
                "complex_transfer_learning_reflection",
                "complex_transfer_new_error_strategy",
            }
            csv_rows = list(csv.DictReader(StringIO(export_service.build_csv(session.id))))
            csv_stage = next(
                row
                for row in csv_rows
                if row["record_type"] == "stage" and row["stage_run_id"] == stage_run_id
            )
            csv_attempts = [
                row
                for row in csv_rows
                if row["record_type"] == "attempt" and row["stage_run_id"] == stage_run_id
            ]
            assert csv_stage["participant_id"] == participant.id
            assert csv_stage["operational_success"] == "True"
            assert csv_stage["autonomous_success"] == "True"
            assert csv_stage["fallback_used"] == "False"
            assert csv_stage["reflection_completed"] == "True"
            assert [row["selected_factor"] for row in csv_attempts] == ["Patch", "Pixel"]
            assert all(row["fallback_used"] == "False" for row in csv_attempts)
        finally:
            app.dependency_overrides.clear()
    engine.dispose()


def test_exhausted_run_resumes_with_history_and_no_fallback_attempt(tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    patch_path = tmp_path / "patch.png"
    delta_path = tmp_path / "delta.pt"
    source = Image.new("RGB", (32, 32), (30, 90, 150))
    source.save(source_path)
    Image.new("RGBA", (8, 8), (230, 30, 10, 255)).save(patch_path)
    tensor = torch.full((3, 32, 32), 0.5)
    save_delta_bundle(create_delta_bundle(tensor, torch.ones_like(tensor), 4 / 255), delta_path)
    engine = create_database_engine(f"sqlite:///{tmp_path / 'exhausted.db'}")
    initialize_database(engine)
    factory = create_session_factory(engine)
    with factory() as database_session:
        repository = ResearchRepository(database_session)
        participant = repository.create_participant("exhausted-participant")
        session = repository.create_session(participant.id, "v2")
        classifier = FakeClassifier(["toaster"] * 6)
        service = ComplexTransferService(repository, classifier, tmp_path, tmp_path / "runtime")
        service.assets = ComplexTransferAssets(source_path, delta_path, patch_path)
        app.dependency_overrides[get_complex_transfer_service] = lambda: service
        try:
            with TestClient(app) as client:
                run = client.post(f"/game/sessions/{session.id}/complex-transfer").json()
                stage_run_id = run["stage_run_id"]
                levels = ["medium", "low", "medium", "none", "high"]
                for index, level in enumerate(levels, start=1):
                    parameters = run["current_parameters"] | {"blur_level": level}
                    response = client.post(
                        f"/game/complex-transfer-runs/{stage_run_id}/reclassify",
                        json={"selected_factor": "blur", "prediction": "stay_same", "parameters": parameters},
                    )
                    assert response.status_code == 201
                    assert response.json()["attempt_index"] == index
                    run["current_parameters"] = parameters

                resumed = client.post(f"/game/sessions/{session.id}/complex-transfer").json()
                assert resumed["stage_run_id"] == stage_run_id
                assert resumed["finished"] is True
                assert resumed["exhausted"] is True
                assert resumed["success"] is False
                assert resumed["remaining_attempts"] == 0
                assert len(resumed["attempts"]) == 5
                assert resumed["reference_recoverable_parameters"] == {
                    "patch": {"size_fraction": 0.1, "position_x": 0.8, "position_y": 0.2},
                    "pixel_strength": 0.0,
                    "blur_level": "low",
                }
                sixth = client.post(
                    f"/game/complex-transfer-runs/{stage_run_id}/reclassify",
                    json={"selected_factor": "pixel", "prediction": "stay_same", "parameters": resumed["current_parameters"] | {"pixel_strength": 2}},
                )
                assert sixth.status_code == 409
                reflection = client.post(
                    f"/game/complex-transfer-runs/{stage_run_id}/reflection",
                    json={
                        "learning_reflection": "The tested changes did not restore this case.",
                        "new_error_strategy": "I would test possible changes and examine the new classification.",
                    },
                )
                assert reflection.status_code == 200
                assert reflection.json()["completed"] is True

            attempts = list(database_session.scalars(select(Attempt).where(Attempt.stage_run_id == stage_run_id)))
            assert len(attempts) == 5
            assert all(not attempt.tool_type.endswith("fallback") for attempt in attempts)
            stage = database_session.scalar(select(StageRun).where(StageRun.id == stage_run_id))
            assert stage is not None
            assert stage.completion_status == "completed"
            assert stage.success is False
            assert stage.classification_restored is False
            assert stage.fallback_shown is False
            assert stage.attempt_count == 5
            assert len(
                list(
                    database_session.scalars(
                        select(Response).where(Response.stage_run_id == stage_run_id)
                    )
                )
            ) == 2
            export_service = ResearchExportService(repository)
            exported_stage = next(
                item
                for item in export_service.build_json(session.id)["stage_runs"]
                if item["id"] == stage_run_id
            )
            outcome = exported_stage["complex_transfer_outcome"]
            assert outcome == {
                "completed": True,
                "attempts_used": 5,
                "operational_success": False,
                "autonomous_success": False,
                "fallback_used": False,
                "duration_seconds": outcome["duration_seconds"],
                "reflection_completed": True,
            }
            assert outcome["duration_seconds"] >= 0
            assert {item["selected_factor"] for item in exported_stage["attempts"]} == {
                "Blur"
            }
        finally:
            app.dependency_overrides.clear()
    engine.dispose()
