"""Verify production inputs, warm the model, and start the single web service."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from scripts.final_assets import BUNDLE_MANIFEST_PATH, FinalAssetError, install_bundle, verify_assets


ASSET_BUNDLE_ENVIRONMENT_VARIABLE = "AI_IMAGE_GAME_FINAL_ASSET_BUNDLE"
ASSET_SHA256_ENVIRONMENT_VARIABLE = "AI_IMAGE_GAME_FINAL_ASSET_SHA256"
EXPECTED_BUNDLE_ID = "ai-image-classifier-game-final-assets-v3.0"
EXPECTED_GAME_VERSION = "v3.0"
EXPECTED_STUDY_PHASE = "final_evaluation"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_assets(project_root: Path) -> dict[str, int]:
    """Install an optional external bundle, then verify the frozen asset manifest."""
    bundle_value = os.getenv(ASSET_BUNDLE_ENVIRONMENT_VARIABLE)
    if bundle_value:
        bundle = Path(bundle_value).expanduser().resolve()
        expected_hash = os.getenv(ASSET_SHA256_ENVIRONMENT_VARIABLE)
        if not expected_hash:
            raise FinalAssetError(
                f"{ASSET_SHA256_ENVIRONMENT_VARIABLE} is required with an asset bundle"
            )
        actual_hash = sha256(bundle)
        if actual_hash != expected_hash:
            raise FinalAssetError(
                f"Final asset bundle SHA256 mismatch: expected {expected_hash}, got {actual_hash}"
            )
        install_bundle(bundle, project_root)

    manifest = project_root / BUNDLE_MANIFEST_PATH
    result = verify_assets(project_root, manifest)
    document = json.loads(manifest.read_text(encoding="utf-8"))
    expected_metadata = {
        "bundle_id": EXPECTED_BUNDLE_ID,
        "game_version": EXPECTED_GAME_VERSION,
        "study_phase": EXPECTED_STUDY_PHASE,
    }
    actual_metadata = {key: document.get(key) for key in expected_metadata}
    if actual_metadata != expected_metadata:
        raise FinalAssetError(
            f"Final asset metadata mismatch: expected {expected_metadata}, "
            f"got {actual_metadata}"
        )
    if result["asset_count"] != 45:
        raise FinalAssetError(
            f"Expected 45 Final assets, verified {result['asset_count']}"
        )
    return result


def main() -> None:
    project_root = Path.cwd().resolve()
    result = prepare_assets(project_root)
    print(
        f"Verified {result['asset_count']} Final assets "
        f"({result['total_bytes']} bytes).",
        flush=True,
    )

    if os.getenv("AI_IMAGE_GAME_PRELOAD_MODEL", "1") != "0":
        from backend.app.model import load_model

        load_model()
        print("Loaded ResNet-34 on CPU.", flush=True)

    port = os.getenv("PORT", "8000")
    os.execvp(
        "python",
        [
            "python",
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            port,
        ],
    )


if __name__ == "__main__":
    main()
