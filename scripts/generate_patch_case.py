"""Apply a patch to an image and save the composed image and JSON metadata."""

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image

from backend.app.image_manipulation import PatchParameters, apply_patch


def display_path(path: Path) -> str:
    """Return a project-relative path when possible."""
    resolved_path = path.resolve()
    try:
        return resolved_path.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return resolved_path.as_posix()


def generate_patch_case(
    source_path: Path,
    patch_path: Path,
    output_image_path: Path,
    metadata_path: Path,
    parameters: PatchParameters,
) -> dict[str, Any]:
    """Compose and save one reproducible patch case."""
    if not source_path.is_file():
        raise ValueError(f"Source image does not exist: {source_path}")
    if not patch_path.is_file():
        raise ValueError(f"Patch image does not exist: {patch_path}")

    with Image.open(source_path) as source_image, Image.open(patch_path) as patch_image:
        source_image.load()
        patch_image.load()
        application = apply_patch(source_image, patch_image, parameters)

    output_image_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    application.image.save(output_image_path, format="PNG")

    metadata = {
        "schema_version": "1.0",
        "manipulation_type": "adversarial_patch",
        "source_path": display_path(source_path),
        "patch_path": display_path(patch_path),
        "output_image_path": display_path(output_image_path),
        **application.metadata,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_image", type=Path)
    parser.add_argument("patch_image", type=Path)
    parser.add_argument("--output-image", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--position-x", type=float, required=True)
    parser.add_argument("--position-y", type=float, required=True)
    parser.add_argument("--size", type=float, required=True)
    args = parser.parse_args()

    try:
        metadata = generate_patch_case(
            source_path=args.source_image,
            patch_path=args.patch_image,
            output_image_path=args.output_image,
            metadata_path=args.metadata,
            parameters=PatchParameters(
                position_x=args.position_x,
                position_y=args.position_y,
                size=args.size,
            ),
        )
    except (OSError, ValueError) as error:
        parser.error(str(error))

    print(
        "Generated patch case at "
        f"{metadata['output_image_path']} with metadata at {args.metadata}"
    )


if __name__ == "__main__":
    main()
