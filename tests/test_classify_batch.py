import json
from pathlib import Path

import pytest
from PIL import Image

from backend.app.schemas import ClassificationResponse, Prediction
from scripts.classify_batch import (
    classify_directory,
    find_image_files,
    write_results,
)


class FakeInferenceService:
    def __init__(self) -> None:
        self.classified_image_count = 0

    def classify(self, image: Image.Image) -> ClassificationResponse:
        self.classified_image_count += 1
        predictions = [
            Prediction(
                label=f"class-{class_index}",
                probability=probability,
                class_index=class_index,
            )
            for class_index, probability in enumerate(
                [0.50, 0.20, 0.15, 0.10, 0.05]
            )
        ]
        return ClassificationResponse(
            model_name="resnet34",
            weights_name="IMAGENET1K_V1",
            top1=predictions[0],
            top5=predictions,
        )


class FalsyInferenceService(FakeInferenceService):
    def __bool__(self) -> bool:
        return False


def save_test_image(path: Path, image_format: str = "PNG") -> None:
    Image.new("RGB", (8, 6), color="blue").save(path, format=image_format)


def test_find_image_files_skips_unsupported_files(tmp_path: Path) -> None:
    save_test_image(tmp_path / "sample.PNG")
    save_test_image(tmp_path / "other.jpg", image_format="JPEG")
    (tmp_path / "notes.txt").write_text("not an image", encoding="utf-8")

    image_files = find_image_files(tmp_path)

    assert [path.name for path in image_files] == ["other.jpg", "sample.PNG"]


def test_classify_directory_records_success_and_failure(tmp_path: Path) -> None:
    save_test_image(tmp_path / "valid.png")
    (tmp_path / "broken.webp").write_bytes(b"not an image")
    (tmp_path / "ignored.txt").write_text("skip me", encoding="utf-8")
    service = FakeInferenceService()

    results = classify_directory(tmp_path, service)

    assert results["model_name"] == "resnet34"
    assert results["weights_name"] == "IMAGENET1K_V1"
    assert results["summary"] == {
        "discovered": 2,
        "succeeded": 1,
        "failed": 1,
    }
    assert service.classified_image_count == 1

    success_record = next(
        record for record in results["images"] if record["status"] == "success"
    )
    assert success_record["image"] == {
        "format": "PNG",
        "width": 8,
        "height": 6,
        "mode": "RGB",
    }
    assert success_record["top1"] == success_record["top5"][0]
    assert len(success_record["top5"]) == 5

    error_record = next(
        record for record in results["images"] if record["status"] == "error"
    )
    assert error_record["filename"] == "broken.webp"
    assert error_record["error_type"] == "UnidentifiedImageError"


def test_classify_directory_accepts_falsy_injected_service(tmp_path: Path) -> None:
    save_test_image(tmp_path / "valid.png")
    service = FalsyInferenceService()

    results = classify_directory(tmp_path, service)

    assert results["summary"]["succeeded"] == 1
    assert service.classified_image_count == 1


def test_classify_directory_returns_empty_summary_for_empty_directory(
    tmp_path: Path,
) -> None:
    results = classify_directory(tmp_path, FakeInferenceService())

    assert results["summary"] == {
        "discovered": 0,
        "succeeded": 0,
        "failed": 0,
    }
    assert results["images"] == []


@pytest.mark.parametrize(
    ("input_path_factory", "expected_message"),
    [
        (lambda tmp_path: tmp_path / "missing", "does not exist"),
        (lambda tmp_path: tmp_path / "file.txt", "is not a directory"),
    ],
)
def test_classify_directory_rejects_invalid_input_path(
    tmp_path: Path,
    input_path_factory,
    expected_message: str,
) -> None:
    input_path = input_path_factory(tmp_path)
    if input_path.suffix:
        input_path.write_text("not a directory", encoding="utf-8")

    with pytest.raises(ValueError, match=expected_message):
        classify_directory(input_path, FakeInferenceService())


def test_write_results_creates_json_file(tmp_path: Path) -> None:
    output_path = tmp_path / "nested" / "results.json"
    results = {"summary": {"discovered": 0, "succeeded": 0, "failed": 0}}

    write_results(results, output_path)

    assert json.loads(output_path.read_text(encoding="utf-8")) == results
