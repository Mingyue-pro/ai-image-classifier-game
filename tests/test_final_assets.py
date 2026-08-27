import json
import tarfile
from pathlib import Path

import pytest

from scripts.final_assets import (
    BUNDLE_MANIFEST_PATH,
    FinalAssetError,
    build_bundle,
    install_bundle,
    verify_assets,
)


def write_inventory(path: Path) -> None:
    path.write_text(json.dumps({
        "schema_version": "1.0",
        "bundle_id": "test-final-assets",
        "game_version": "v3.0",
        "study_phase": "final_evaluation",
        "assets": [{"path": "data/example.png", "role": "source_image"}],
    }), encoding="utf-8")


def test_build_install_and_verify_final_asset_bundle(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    inventory = source / "inventory.json"
    write_inventory(inventory)
    asset = source / "data/example.png"
    asset.parent.mkdir()
    asset.write_bytes(b"formal-image")
    bundle = tmp_path / "final-assets.tar.gz"

    manifest = build_bundle(source, inventory, bundle)
    assert manifest["assets"][0]["sha256"]
    with tarfile.open(bundle, "r:gz") as archive:
        assert set(archive.getnames()) == {
            BUNDLE_MANIFEST_PATH.as_posix(),
            "data/example.png",
        }

    destination = tmp_path / "destination"
    destination.mkdir()
    installed = install_bundle(bundle, destination)
    assert installed["asset_count"] == 1
    assert (destination / "data/example.png").read_bytes() == b"formal-image"
    assert verify_assets(destination, destination / BUNDLE_MANIFEST_PATH)["asset_count"] == 1


def test_verify_detects_a_changed_asset(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    inventory = source / "inventory.json"
    write_inventory(inventory)
    asset = source / "data/example.png"
    asset.parent.mkdir()
    asset.write_bytes(b"formal-image")
    bundle = tmp_path / "final-assets.tar.gz"
    build_bundle(source, inventory, bundle)
    install_bundle(bundle, source)
    asset.write_bytes(b"changed")

    with pytest.raises(FinalAssetError, match="size mismatch|SHA256 mismatch"):
        verify_assets(source, source / BUNDLE_MANIFEST_PATH)


def test_install_refuses_to_replace_a_different_existing_asset(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    inventory = source / "inventory.json"
    write_inventory(inventory)
    asset = source / "data/example.png"
    asset.parent.mkdir()
    asset.write_bytes(b"formal-image")
    bundle = tmp_path / "final-assets.tar.gz"
    build_bundle(source, inventory, bundle)

    destination = tmp_path / "destination"
    existing = destination / "data/example.png"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"different")
    with pytest.raises(FinalAssetError, match="Refusing to replace"):
        install_bundle(bundle, destination)
