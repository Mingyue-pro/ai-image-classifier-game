"""Read-only access to the validated runtime case matrix."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


CASE_MATRIX_PATH_ENVIRONMENT_VARIABLE = "AI_IMAGE_GAME_CASE_MATRIX_PATH"
DEFAULT_CASE_MATRIX_PATH = Path("data/results/case-matrix.json")


class CaseCatalogError(ValueError):
    """Raised when the case matrix is unavailable or invalid."""


class CaseNotFoundError(CaseCatalogError):
    """Raised when a requested configured case does not exist."""


class CaseCatalog:
    """Load and search one validated case-matrix JSON file."""

    def __init__(self, matrix_path: Path) -> None:
        self.matrix_path = matrix_path
        self._cases_by_id: dict[str, dict[str, Any]] | None = None

    def _load_cases(self) -> dict[str, dict[str, Any]]:
        if self._cases_by_id is not None:
            return self._cases_by_id
        if not self.matrix_path.is_file():
            raise CaseCatalogError(
                f"Case matrix does not exist: {self.matrix_path.as_posix()}"
            )
        try:
            matrix = json.loads(self.matrix_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise CaseCatalogError(f"Could not read case matrix: {error}") from error
        raw_cases = matrix.get("cases") if isinstance(matrix, dict) else None
        if not isinstance(raw_cases, list):
            raise CaseCatalogError("Case matrix must contain a cases list")
        cases_by_id: dict[str, dict[str, Any]] = {}
        for case in raw_cases:
            if not isinstance(case, dict) or not isinstance(case.get("case_id"), str):
                raise CaseCatalogError("Each case must contain a string case_id")
            case_id = case["case_id"]
            if case_id in cases_by_id:
                raise CaseCatalogError(f"Duplicate case_id in matrix: {case_id}")
            cases_by_id[case_id] = case
        self._cases_by_id = cases_by_id
        return cases_by_id

    def get_case(self, case_id: str) -> dict[str, Any]:
        """Return a configured case or raise when it is unknown."""
        case = self._load_cases().get(case_id)
        if case is None:
            raise CaseNotFoundError(f"Case does not exist: {case_id}")
        return case

    def get_initial_top1_label(self, case: dict[str, Any]) -> str:
        """Return the trusted Top-1 label for a case's initial state."""
        initial_state_id = case.get("initial_state_id")
        states = case.get("states")
        if not isinstance(initial_state_id, str) or not isinstance(states, list):
            raise CaseCatalogError("Case is missing initial state information")
        for state in states:
            if not isinstance(state, dict) or state.get("state_id") != initial_state_id:
                continue
            top1 = state.get("top1")
            if isinstance(top1, dict) and isinstance(top1.get("label"), str):
                return top1["label"]
            break
        raise CaseCatalogError("Initial case state is missing a Top-1 label")


def configured_case_matrix_path() -> Path:
    """Return an environment override or the default generated matrix path."""
    return Path(
        os.getenv(
            CASE_MATRIX_PATH_ENVIRONMENT_VARIABLE,
            DEFAULT_CASE_MATRIX_PATH.as_posix(),
        )
    )
