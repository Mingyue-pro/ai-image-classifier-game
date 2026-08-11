"""Build the participant-facing Investigator Report from trusted research records."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from backend.app.case_catalog import CaseCatalog
from backend.app.repositories.research_repository import ResearchRepository


FALLBACK_PREDICTIONS = {"verified_fallback", "verified_fallback_will_restore"}
TRANSFER_REPAIR_HYPOTHESES = {
    "move_patch", "reduce_patch", "move_and_resize_patch", "reduce_pixel_strength"
}
STAGE_NAMES = {
    "stage1": "Tutorial",
    "stage2": "Condition Investigation",
    "stage3": "Repair Investigation",
    "transfer": "Transfer",
}


def _prediction_match(prediction: str | None, changed: bool, restored: bool) -> bool | None:
    if prediction in (None, "uncertain") or prediction in FALLBACK_PREDICTIONS:
        return None
    if prediction == "classification_changes":
        return changed
    if prediction == "classification_stays_same":
        return not changed
    if prediction == "restored":
        return restored
    if prediction == "still_incorrect":
        return not restored
    return None


class InvestigatorReportService:
    """Aggregate one anonymous Session without exposing internal identifiers."""

    def __init__(self, repository: ResearchRepository, case_catalog: CaseCatalog) -> None:
        self.repository = repository
        self.case_catalog = case_catalog

    def build(self, session_id: str) -> dict[str, Any]:
        records = self.repository.get_session_export_records(session_id)
        session = records["session"]
        stages = records["stage_runs"]
        stage_by_id = {stage.id: stage for stage in stages}
        attempts_by_stage: dict[str, list[Any]] = defaultdict(list)
        for attempt in records["attempts"]:
            attempts_by_stage[attempt.stage_run_id].append(attempt)

        latest_responses: dict[str, Any] = {}
        for response in records["responses"]:
            latest_responses[response.question_key] = response

        evidence: list[dict[str, Any]] = []
        decisive_matches: list[bool] = []
        uncertain_count = 0
        prediction_count = 0
        autonomous_count = 0
        fallback_count = 0
        autonomous_restored = 0

        for attempt in records["attempts"]:
            stage = stage_by_id[attempt.stage_run_id]
            case = self.case_catalog.get_case(stage.case_id)
            correct_label = str(case["correct_label"])
            fallback = attempt.predicted_outcome in FALLBACK_PREDICTIONS
            match = _prediction_match(
                attempt.predicted_outcome,
                attempt.classification_changed,
                attempt.classification_restored,
            )
            if (
                stage.stage == "transfer"
                and attempt.predicted_outcome in TRANSFER_REPAIR_HYPOTHESES
            ):
                # In Transfer the learner predicts a repair direction rather
                # than a separate outcome. Restoration supports that hypothesis.
                match = attempt.classification_restored
            if fallback:
                fallback_count += 1
            else:
                autonomous_count += 1
                if attempt.predicted_outcome:
                    prediction_count += 1
                if attempt.predicted_outcome == "uncertain":
                    uncertain_count += 1
                if match is not None:
                    decisive_matches.append(match)
                if attempt.classification_restored:
                    autonomous_restored += 1

            top5 = attempt.top5_after or []
            top1_probability = next(
                (item.get("probability") for item in top5 if item.get("label") == attempt.top1_after),
                None,
            )
            correct_rank = next(
                (index for index, item in enumerate(top5, start=1) if item.get("label") == correct_label),
                None,
            )
            evidence.append(
                {
                    "stage": stage.stage,
                    "stage_name": STAGE_NAMES.get(stage.stage, stage.stage),
                    "case_id": stage.case_id,
                    "method": "Pixel" if stage.attack_type == "fgsm" else "Patch",
                    "attempt_number": attempt.attempt_number,
                    "fallback": fallback,
                    "tool_type": attempt.tool_type,
                    "parameters_before": attempt.parameters_before,
                    "parameters_after": attempt.parameters_after,
                    "prediction": attempt.predicted_outcome,
                    "prediction_reason": attempt.prediction_reason,
                    "prediction_match": match,
                    "top1_before": attempt.top1_before,
                    "top1_after": attempt.top1_after,
                    "classification_changed": attempt.classification_changed,
                    "classification_restored": attempt.classification_restored,
                    "confidence_after": top1_probability,
                    "correct_rank_after": correct_rank,
                }
            )

        completed_stages = {
            stage.stage for stage in stages if stage.completion_status == "completed"
        }
        transfer_strategy = self._answer_value(latest_responses.get("transfer_next_step_strategy"))
        transfer_conclusion = self._answer_value(latest_responses.get("transfer_evidence_conclusion"))
        fallback_methods = sorted(
            {
                "Pixel" if stage.attack_type == "fgsm" else "Patch"
                for stage in stages
                if stage.fallback_shown
            }
        )
        feedback = self._feedback(
            uncertain_count,
            decisive_matches,
            fallback_methods,
        )
        return {
            "report_version": 1,
            "session": {
                "completion_status": session.completion_status,
                "completed_at": session.completed_at.isoformat() if session.completed_at else None,
                "game_version": session.game_version,
            },
            "overview": {
                "stages_completed": len(completed_stages & set(STAGE_NAMES)),
                "stages_total": 4,
                "evidence_records": len(evidence),
                "autonomous_attempts": autonomous_count,
                "fallback_records": fallback_count,
                "predictions_recorded": prediction_count,
                "decisive_predictions": len(decisive_matches),
                "prediction_matches": sum(decisive_matches),
                "uncertain_predictions": uncertain_count,
                "autonomous_restorations": autonomous_restored,
                "fallback_methods": fallback_methods,
            },
            "process_profile": {
                "controlled_adjustments": autonomous_count,
                "transfer_conclusion_status": (
                    "supported" if transfer_conclusion == "conditional_evidence" else "review_recommended"
                ),
            },
            "transfer": {
                "strategy": transfer_strategy,
                "strategy_reason": self._answer_text(latest_responses.get("transfer_next_step_reason")),
                "repairs": {
                    "Patch": {
                        "direction": self._answer_value(latest_responses.get("transfer_patch_repair_direction")),
                        "reason": self._answer_text(latest_responses.get("transfer_patch_repair_reason")),
                    },
                    "Pixel": {
                        "direction": self._answer_value(latest_responses.get("transfer_pixel_repair_direction")),
                        "reason": self._answer_text(latest_responses.get("transfer_pixel_repair_reason")),
                    },
                },
                "evidence_conclusion": transfer_conclusion,
                "evidence_explanation": self._answer_text(latest_responses.get("transfer_evidence_explanation")),
            },
            "stage3_reflection": {
                "initial_repair_evaluation": self._answer_json(latest_responses.get("stage3_initial_repair_evaluation")),
                "reconsideration": self._answer_text(latest_responses.get("stage3_reconsideration")),
                "remaining_uncertainty": self._answer_json(latest_responses.get("stage3_remaining_uncertainty")),
                "case_takeaway": self._answer_text(latest_responses.get("stage3_case_takeaway")),
            },
            "evidence": evidence,
            "feedback": feedback,
        }

    @staticmethod
    def _answer_value(response: Any | None) -> str | None:
        return response.answer_value if response else None

    @staticmethod
    def _answer_text(response: Any | None) -> str | None:
        return response.answer_text if response else None

    @staticmethod
    def _answer_json(response: Any | None) -> Any | None:
        return response.answer_json if response else None

    @staticmethod
    def _feedback(
        uncertain_count: int,
        matches: list[bool],
        fallback_methods: list[str],
    ) -> list[str]:
        feedback: list[str] = []
        if uncertain_count:
            feedback.append("Expressing uncertainty can be appropriate when the available evidence is limited.")
        else:
            feedback.append("Use ‘Not sure’ when the available evidence is genuinely insufficient rather than forcing a guess.")
        if any(not matched for matched in matches):
            feedback.append("A prediction mismatch is useful evidence for reconsidering a hypothesis.")
        if fallback_methods:
            feedback.append(f"A verified fallback was used for: {', '.join(fallback_methods)}. This is not counted as an autonomous repair.")
        return feedback
