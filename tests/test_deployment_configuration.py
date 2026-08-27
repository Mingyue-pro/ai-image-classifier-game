from pathlib import Path

from backend.app.dependencies import configured_runtime_root


def test_runtime_root_defaults_to_project_data(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("AI_IMAGE_GAME_RUNTIME_ROOT", raising=False)

    assert configured_runtime_root(tmp_path) == tmp_path / "data" / "runtime"


def test_runtime_root_accepts_absolute_environment_override(
    monkeypatch, tmp_path: Path
) -> None:
    persistent = tmp_path / "volume" / "runtime"
    monkeypatch.setenv("AI_IMAGE_GAME_RUNTIME_ROOT", str(persistent))

    assert configured_runtime_root(tmp_path) == persistent.resolve()
