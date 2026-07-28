from collections.abc import Iterator
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import backend.app.inference as inference_module
from backend.app.dependencies import get_inference_service
from backend.app.main import app
from backend.app.schemas import ClassificationResponse, Prediction


class FakeInferenceService:
    def classify(self, image: Image.Image) -> ClassificationResponse:
        assert image.size == (8, 8)
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


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_inference_service] = lambda: FakeInferenceService()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def make_png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), color="blue").save(buffer, format="PNG")
    return buffer.getvalue()


def test_classify_accepts_valid_image(client: TestClient) -> None:
    response = client.post(
        "/classify",
        files={"file": ("sample.png", make_png(), "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["model_name"] == "resnet34"


def test_classify_rejects_invalid_image_data(client: TestClient) -> None:
    response = client.post(
        "/classify",
        files={"file": ("broken.png", b"not an image", "image/png")},
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "The uploaded file does not contain a valid image."
    }


def test_classify_response_contains_top1_and_top5(client: TestClient) -> None:
    response = client.post(
        "/classify",
        files={"file": ("sample.png", make_png(), "image/png")},
    )

    payload = response.json()
    assert set(payload) == {"model_name", "weights_name", "top1", "top5"}
    assert len(payload["top5"]) == 5
    assert payload["top1"] == payload["top5"][0]
    assert set(payload["top1"]) == {"label", "probability", "class_index"}


# Upload invalid image, load_model() should not be called
def test_invalid_image_does_not_load_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    load_model_call_count = 0

    def track_load_model_call() -> object:
        nonlocal load_model_call_count
        load_model_call_count += 1
        return object()

    monkeypatch.setattr(
        inference_module,
        "load_model",
        track_load_model_call,
    )

    get_inference_service.cache_clear()

    try:
        with TestClient(app) as test_client:
            response = test_client.post(
                "/classify",
                files={
                    "file": (
                        "broken.png",
                        b"not an image",
                        "image/png",
                    )
                },
            )

        assert response.status_code == 400
        assert load_model_call_count == 0
    finally:
        get_inference_service.cache_clear()
