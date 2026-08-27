"""Build, install, and verify the versioned Final evaluation asset bundle."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any


DEFAULT_INVENTORY = Path("config/final_asset_inventory.json")
BUNDLE_MANIFEST_PATH = Path("data/final-assets-manifest.json")


class FinalAssetError(ValueError):
    """Raised when a Final asset inventory or bundle is unsafe or incomplete."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FinalAssetError(f"Could not read JSON file {path}: {error}") from error
    if not isinstance(value, dict):
        raise FinalAssetError(f"JSON root must be an object: {path}")
    return value


def _safe_relative_path(value: str) -> Path:
    pure = PurePosixPath(value)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise FinalAssetError(f"Asset path must be project-relative and safe: {value}")
    return Path(*pure.parts)


def _asset_entries(document: dict[str, Any]) -> list[dict[str, Any]]:
    assets = document.get("assets")
    if not isinstance(assets, list) or not assets:
        raise FinalAssetError("Asset document must contain a non-empty assets list")
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for entry in assets:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise FinalAssetError("Every asset entry must contain a string path")
        path = _safe_relative_path(entry["path"]).as_posix()
        if path in seen:
            raise FinalAssetError(f"Duplicate asset path: {path}")
        seen.add(path)
        result.append({**entry, "path": path})
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _runtime_references(project_root: Path) -> set[str]:
    matrix_path = project_root / "data/results/case-matrix.json"
    if not matrix_path.is_file():
        return set()
    matrix = _load_json(matrix_path)
    references = {"data/results/case-matrix.json"}
    cases = matrix.get("cases")
    if not isinstance(cases, list):
        raise FinalAssetError("Runtime case matrix must contain a cases list")
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("states"), list):
            raise FinalAssetError("Runtime case matrix contains an invalid case")
        for state in case["states"]:
            if not isinstance(state, dict):
                raise FinalAssetError("Runtime case matrix contains an invalid state")
            for key in ("image_path", "source_image_path"):
                value = state.get(key)
                if isinstance(value, str):
                    references.add(_safe_relative_path(value).as_posix())
            parameters = state.get("parameters")
            if isinstance(parameters, dict):
                for key in ("patch_path", "delta_path"):
                    value = parameters.get(key)
                    if isinstance(value, str):
                        references.add(_safe_relative_path(value).as_posix())
    return references


def _validate_inventory_coverage(project_root: Path, inventory: dict[str, Any]) -> None:
    listed = {entry["path"] for entry in _asset_entries(inventory)}
    missing = sorted(_runtime_references(project_root) - listed)
    if missing:
        raise FinalAssetError(
            "Final asset inventory omits runtime case assets: " + ", ".join(missing)
        )


def build_manifest(project_root: Path, inventory_path: Path) -> dict[str, Any]:
    inventory = _load_json(inventory_path)
    _validate_inventory_coverage(project_root, inventory)
    manifest = {key: inventory.get(key) for key in ("schema_version", "bundle_id", "game_version", "study_phase")}
    manifest["assets"] = []
    for entry in _asset_entries(inventory):
        asset = project_root / entry["path"]
        if not asset.is_file():
            raise FinalAssetError(f"Required Final asset is missing: {entry['path']}")
        manifest["assets"].append({
            "path": entry["path"],
            "role": entry.get("role", "unspecified"),
            "size_bytes": asset.stat().st_size,
            "sha256": _sha256(asset),
        })
    return manifest


def verify_assets(project_root: Path, document_path: Path) -> dict[str, int]:
    document = _load_json(document_path)
    checked = 0
    total_bytes = 0
    for entry in _asset_entries(document):
        asset = project_root / entry["path"]
        if not asset.is_file():
            raise FinalAssetError(f"Required Final asset is missing: {entry['path']}")
        size = asset.stat().st_size
        expected_size = entry.get("size_bytes")
        if expected_size is not None and size != expected_size:
            raise FinalAssetError(f"Final asset size mismatch: {entry['path']}")
        expected_hash = entry.get("sha256")
        if expected_hash is not None and _sha256(asset) != expected_hash:
            raise FinalAssetError(f"Final asset SHA256 mismatch: {entry['path']}")
        checked += 1
        total_bytes += size
    return {"asset_count": checked, "total_bytes": total_bytes}


def build_bundle(project_root: Path, inventory_path: Path, output_path: Path) -> dict[str, Any]:
    manifest = build_manifest(project_root, inventory_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    with tarfile.open(output_path, "w:gz") as archive:
        info = tarfile.TarInfo(BUNDLE_MANIFEST_PATH.as_posix())
        info.size = len(manifest_bytes)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(manifest_bytes))
        for entry in manifest["assets"]:
            archive.add(project_root / entry["path"], arcname=entry["path"], recursive=False)
    return manifest


def install_bundle(bundle_path: Path, project_root: Path, *, replace: bool = False) -> dict[str, int]:
    with tarfile.open(bundle_path, "r:gz") as archive:
        try:
            manifest_member = archive.getmember(BUNDLE_MANIFEST_PATH.as_posix())
            manifest_stream = archive.extractfile(manifest_member)
        except (KeyError, tarfile.TarError) as error:
            raise FinalAssetError("Bundle does not contain its Final asset manifest") from error
        if manifest_stream is None:
            raise FinalAssetError("Bundle manifest could not be read")
        try:
            manifest = json.loads(manifest_stream.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise FinalAssetError("Bundle manifest is invalid") from error
        entries = _asset_entries(manifest)
        expected_members = {entry["path"] for entry in entries} | {BUNDLE_MANIFEST_PATH.as_posix()}
        actual_members = {member.name for member in archive.getmembers() if member.isfile()}
        if actual_members != expected_members:
            raise FinalAssetError("Bundle contents do not exactly match its manifest")

        with tempfile.TemporaryDirectory(prefix="ai-image-game-final-assets-") as temporary:
            temporary_root = Path(temporary)
            for entry in entries:
                member = archive.getmember(entry["path"])
                stream = archive.extractfile(member)
                if stream is None:
                    raise FinalAssetError(f"Bundle asset could not be read: {entry['path']}")
                destination = temporary_root / entry["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("wb") as output:
                    shutil.copyfileobj(stream, output)
            temporary_manifest = temporary_root / BUNDLE_MANIFEST_PATH
            temporary_manifest.parent.mkdir(parents=True, exist_ok=True)
            temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            verify_assets(temporary_root, temporary_manifest)

            for entry in entries:
                destination = project_root / entry["path"]
                if destination.exists() and not replace:
                    if destination.is_file() and _sha256(destination) == entry.get("sha256"):
                        continue
                    raise FinalAssetError(f"Refusing to replace existing asset without --replace: {entry['path']}")
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(temporary_root / entry["path"], destination)
            installed_manifest = project_root / BUNDLE_MANIFEST_PATH
            installed_manifest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(temporary_manifest, installed_manifest)
    return verify_assets(project_root, project_root / BUNDLE_MANIFEST_PATH)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    subparsers = parser.add_subparsers(dest="command", required=True)

    verify = subparsers.add_parser("verify", help="Check installed Final assets")
    verify.add_argument("--manifest", type=Path)

    build = subparsers.add_parser("build", help="Build a versioned .tar.gz asset bundle")
    build.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    build.add_argument("--output", type=Path, required=True)

    install = subparsers.add_parser("install", help="Install and verify an asset bundle")
    install.add_argument("bundle", type=Path)
    install.add_argument("--replace", action="store_true")

    args = parser.parse_args()
    root = args.project_root.resolve()
    try:
        if args.command == "verify":
            manifest = args.manifest or (root / BUNDLE_MANIFEST_PATH)
            if not manifest.is_absolute():
                manifest = root / manifest
            result = verify_assets(root, manifest)
            print(f"Verified {result['asset_count']} Final assets ({result['total_bytes']} bytes).")
        elif args.command == "build":
            inventory = args.inventory if args.inventory.is_absolute() else root / args.inventory
            output = args.output if args.output.is_absolute() else root / args.output
            manifest = build_bundle(root, inventory, output)
            print(f"Built {manifest['bundle_id']} with {len(manifest['assets'])} assets: {output}")
        else:
            bundle = args.bundle if args.bundle.is_absolute() else root / args.bundle
            result = install_bundle(bundle, root, replace=args.replace)
            print(f"Installed and verified {result['asset_count']} Final assets ({result['total_bytes']} bytes).")
    except FinalAssetError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
