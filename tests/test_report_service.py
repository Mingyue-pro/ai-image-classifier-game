from datetime import datetime, timezone
from types import SimpleNamespace

from backend.app.report_service import InvestigatorReportService


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
