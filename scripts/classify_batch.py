"""Classify supported images in a directory and save the results as JSON."""

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image

from backend.app.inference import ImageClassifier, ResNet34InferenceService
from backend.app.model import MODEL_NAME, WEIGHTS


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def display_path(path: Path) -> str:
    """Return a project-relative path when possible."""
    resolved_path = path.resolve()
    try:
        return resolved_path.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return resolved_path.as_posix()


def find_image_files(input_directory: Path) -> list[Path]:
    """Find supported image files recursively in a directory."""
    return sorted(
        (
            path
            for path in input_directory.rglob("*")
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        ),
        key=lambda path: path.as_posix().lower(),
    )


def classify_image_file(
    image_path: Path,
    service: ImageClassifier,
) -> dict[str, Any]:
    """Classify one image file and return a success or error record."""
    try:
        with Image.open(image_path) as image:
            image.load()
            image_information = {
                "format": image.format,
                "width": image.width,
                "height": image.height,
                "mode": image.mode,
            }
            result = service.classify(image)

        return {
            "source_path": display_path(image_path),
            "filename": image_path.name,
            "status": "success",
            "image": image_information,
            "top1": result.top1.model_dump(),
            "top5": [prediction.model_dump() for prediction in result.top5],
        }
    except Exception as error:
        # A single unreadable image must not stop the rest of the batch.
        return {
            "source_path": display_path(image_path),
            "filename": image_path.name,
            "status": "error",
            "error_type": type(error).__name__,
            "error": str(error),
        }


def classify_directory(
    input_directory: Path,
    service: ImageClassifier | None = None,
) -> dict[str, Any]:
    """Classify all supported images in a directory with one shared service."""
    if not input_directory.exists():
        raise ValueError(f"Input directory does not exist: {input_directory}")
    if not input_directory.is_dir():
        raise ValueError(f"Input path is not a directory: {input_directory}")

    image_files = find_image_files(input_directory)
    classifier = service if service is not None else ResNet34InferenceService()
    image_records = [
        classify_image_file(image_path, classifier) for image_path in image_files
    ]
    succeeded = sum(record["status"] == "success" for record in image_records)
    failed = len(image_records) - succeeded

    return {
        "schema_version": "1.0",
        "model_name": MODEL_NAME,
        "weights_name": WEIGHTS.name,
        "input_directory": display_path(input_directory),
        "summary": {
            "discovered": len(image_records),
            "succeeded": succeeded,
            "failed": failed,
        },
        "images": image_records,
    }


def write_results(results: dict[str, Any], output_path: Path) -> None:
    """Write batch classification results to a UTF-8 JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_directory", type=Path, help="Directory of images")
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path for the output JSON file",
    )
    args = parser.parse_args()

    try:
        results = classify_directory(args.input_directory)
        write_results(results, args.output)
    except ValueError as error:
        parser.error(str(error))

    summary = results["summary"]
    print(
        f"Classified {summary['succeeded']} of {summary['discovered']} images; "
        f"{summary['failed']} failed. Results: {args.output}"
    )


if __name__ == "__main__":
    main()
