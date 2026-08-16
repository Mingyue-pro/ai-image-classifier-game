from datetime import datetime, timezone
from types import SimpleNamespace

from backend.app.report_service import InvestigatorReportService, _attempt_method


class FakeRepository:
    def get_session_export_records(self, session_id: str):
        assert session_id == "session-secret"
        stage = SimpleNamespace(
            id="stage-secret", case_id="transfer-case", stage="transfer",
            attack_type="patch", completion_status="completed", fallback_shown=True,
        )
        attempts = [
            SimpleNamespace(
                id="attempt-secret", stage_run_id=stage.id, attempt_number=1,
                tool_type="adjust_patch", parameters_before={"size_fraction": 0.3},
                parameters_after={"size_fraction": 0.2}, predicted_outcome="move_patch",
                prediction_reason="A smaller Patch may help.", top1_before="toaster",
                top1_after="toaster", top5_after=[{"label": "toaster", "probability": 0.7}],
                classification_changed=False, classification_restored=False,
                output_image_path="data/runtime/private.png",
            ),
            SimpleNamespace(
                id="fallback-secret", stage_run_id=stage.id, attempt_number=2,
                tool_type="adjust_patch", parameters_before={"size_fraction": 0.2},
                parameters_after={"size_fraction": 0.1},
                predicted_outcome="verified_fallback_will_restore",
                prediction_reason="System fallback", top1_before="toaster",
                top1_after="ice cream",
                top5_after=[{"label": "ice cream", "probability": 0.9}],
                classification_changed=True, classification_restored=True,
                output_image_path="data/runtime/fallback.png",
            ),
        ]
        responses = [
            SimpleNamespace(question_key="transfer_next_step_strategy", answer_value="controlled_investigation", answer_text=None, answer_json=None),
            SimpleNamespace(question_key="transfer_next_step_reason", answer_value=None, answer_text="It creates comparable evidence.", answer_json=None),
            SimpleNamespace(question_key="transfer_patch_repair_direction", answer_value="move_patch", answer_text=None, answer_json=None),
            SimpleNamespace(question_key="transfer_patch_repair_reason", answer_value=None, answer_text="It changes one controlled Patch property.", answer_json=None),
            SimpleNamespace(question_key="transfer_pixel_repair_direction", answer_value="reduce_pixel_strength", answer_text=None, answer_json=None),
            SimpleNamespace(question_key="transfer_pixel_repair_reason", answer_value=None, answer_text="It changes one controlled Pixel property.", answer_json=None),
            SimpleNamespace(question_key="transfer_evidence_conclusion", answer_value="conditional_evidence", answer_text=None, answer_json=None),
            SimpleNamespace(question_key="transfer_evidence_explanation", answer_value=None, answer_text="The first result did not restore the class.", answer_json=None),
        ]
        return {
            "session": SimpleNamespace(
                completion_status="completed", completed_at=datetime(2026, 8, 4, tzinfo=timezone.utc), game_version="mvp-1",
            ),
            "stage_runs": [stage], "attempts": attempts, "responses": responses,
            "participant": SimpleNamespace(), "events": [],
        }


class FakeCatalog:
    def get_case(self, case_id: str):
        assert case_id == "transfer-case"
        return {"correct_label": "ice cream"}


class ComplexTransferRepository:
    def __init__(self, successful: bool) -> None:
        self.successful = successful

    def get_session_export_records(self, session_id: str):
        assert session_id == "complex-session"
        attempt_count = 3 if self.successful else 5
        stage = SimpleNamespace(
            id="complex-stage",
            case_id="complex-transfer-icecream",
            stage="transfer",
            attack_type="complex",
            completion_status="completed",
            success=self.successful,
            attempt_count=attempt_count,
            fallback_shown=False,
            classification_restored=self.successful,
            initial_top1_label="toaster",
            final_top1_label="ice cream" if self.successful else "eggnog",
        )
        factors = ["blur", "pixel", "patch"] if self.successful else ["pixel", "patch", "blur", "pixel", "patch"]
        attempts = []
        for number, factor in enumerate(factors, start=1):
            before = {
                "patch_enabled": True,
                "patch_size_fraction": 0.3,
                "patch_position_x": 0.6,
                "patch_position_y": 0.2,
                "epsilon_pixels": 4.0 if number == 1 else 2.0,
                "blur_level": "high" if number == 1 else "low",
                "blur_radius": 16 if number == 1 else 4,
            }
            after = dict(before)
            if factor == "blur":
                after.update(blur_level="low", blur_radius=4)
            elif factor == "pixel":
                after["epsilon_pixels"] = 0.0
            else:
                after.update(patch_size_fraction=0.1, patch_position_x=0.8)
            restored = self.successful and number == attempt_count
            attempts.append(SimpleNamespace(
                id=f"attempt-{number}", stage_run_id=stage.id, attempt_number=number,
                tool_type=f"complex_transfer_{factor}", parameters_before=before,
                parameters_after=after, predicted_outcome="restore_correct",
                prediction_reason="Test one factor." if number == 1 else None,
                top1_before="toaster", top1_after="ice cream" if restored else "eggnog",
                top5_after=[{"label": "ice cream" if restored else "eggnog", "probability": 0.7}],
                classification_changed=True, classification_restored=restored,
                output_image_path=f"data/runtime/attempt-{number}.png",
            ))
        responses = [
            SimpleNamespace(question_key="complex_transfer_learning_reflection", answer_value=None, answer_text="Each result informed the next attempt.", answer_json=None),
            SimpleNamespace(question_key="complex_transfer_new_error_strategy", answer_value=None, answer_text="I would test one possible change and compare the result.", answer_json=None),
        ]
        return {
            "session": SimpleNamespace(completion_status="completed", completed_at=datetime(2026, 8, 16, tzinfo=timezone.utc), game_version="v2"),
            "stage_runs": [stage], "attempts": list(reversed(attempts)), "responses": responses,
            "participant": SimpleNamespace(), "events": [],
        }


def test_report_calculates_predictions_and_separates_fallback() -> None:
    report = InvestigatorReportService(FakeRepository(), FakeCatalog()).build("session-secret")

    assert report["overview"] == {
        "stages_completed": 1,
        "stages_total": 4,
        "evidence_records": 2,
        "autonomous_attempts": 1,
        "fallback_records": 1,
        "predictions_recorded": 1,
        "decisive_predictions": 1,
        "prediction_matches": 0,
        "uncertain_predictions": 0,
        "autonomous_restorations": 0,
        "fallback_methods": ["Patch"],
    }
    assert report["evidence"][0]["prediction_match"] is False
    assert report["evidence"][1]["prediction_match"] is None
    assert report["evidence"][1]["fallback"] is True
    assert report["evidence"][1]["correct_rank_after"] == 1
    assert report["process_profile"]["transfer_conclusion_status"] == "supported"
    assert report["transfer"]["strategy"] == "controlled_investigation"
    assert report["transfer"]["repairs"]["Patch"]["direction"] == "move_patch"
    assert report["transfer"]["repairs"]["Pixel"]["direction"] == "reduce_pixel_strength"


def test_report_does_not_expose_internal_ids_or_paths() -> None:
    report = InvestigatorReportService(FakeRepository(), FakeCatalog()).build("session-secret")
    rendered = repr(report)

    assert "session-secret" not in rendered
    assert "stage-secret" not in rendered
    assert "attempt-secret" not in rendered
    assert "data/runtime" not in rendered


def test_complex_transfer_methods_are_not_collapsed_into_patch() -> None:
    assert _attempt_method("complex", "complex_transfer_patch") == "Patch"
    assert _attempt_method("complex", "complex_transfer_pixel") == "Pixel"
    assert _attempt_method("complex", "complex_transfer_blur") == "Blur"


def test_success_report_builds_one_ordered_complex_transfer_timeline() -> None:
    report = InvestigatorReportService(ComplexTransferRepository(True), FakeCatalog()).build("complex-session")
    transfer = report["complex_transfer"]

    assert transfer["attempts_used"] == 3
    assert transfer["operational_success"] is True
    assert transfer["autonomous_success"] is True
    assert transfer["fallback_used"] is False
    assert transfer["classification_restored"] is True
    assert [item["attempt_number"] for item in transfer["attempts"]] == [1, 2, 3]
    assert [item["selected_factor"] for item in transfer["attempts"]] == ["Blur", "Pixel", "Patch"]
    assert transfer["attempts"][0]["prediction_reason"] == "Test one factor."
    assert transfer["reflection"] == {
        "learning_reflection": "Each result informed the next attempt.",
        "new_error_strategy": "I would test one possible change and compare the result.",
    }
    assert transfer["verified_reference"] is None
    assert "reasoning_success" not in repr(transfer)


def test_exhausted_report_keeps_reference_separate_from_five_user_attempts() -> None:
    report = InvestigatorReportService(ComplexTransferRepository(False), FakeCatalog()).build("complex-session")
    transfer = report["complex_transfer"]

    assert transfer["attempts_used"] == 5
    assert len(transfer["attempts"]) == 5
    assert transfer["operational_success"] is False
    assert transfer["autonomous_success"] is False
    assert transfer["fallback_used"] is False
    assert transfer["classification_restored"] is False
    assert transfer["verified_reference"]["classification"] == "ice cream"
    assert transfer["verified_reference"]["parameters"]["patch_size_fraction"] == 0.1
    assert all(item["attempt_number"] <= 5 for item in transfer["attempts"])
