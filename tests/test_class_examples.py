import json
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.class_examples import ClassExampleCatalog
from backend.app.dependencies import get_class_example_catalog
from backend.app.main import app


def write_examples(root: Path) -> ClassExampleCatalog:
    image_path = root / "mailbox" / "mailbox-01.jpeg"
    image_path.parent.mkdir(parents=True)
    Image.new("RGB", (12, 10), "blue").save(image_path)
    (root / "examples.json").write_text(
        json.dumps(
            {
                "mailbox": [
                    {
                        "image_path": "mailbox/mailbox-01.jpeg",
                        "source": "Test ImageNet source",
                        "alt": "A roadside mailbox",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return ClassExampleCatalog(root)


def test_predicted_class_examples_return_metadata_and_image(tmp_path: Path) -> None:
    catalog = write_examples(tmp_path / "examples")
    app.dependency_overrides[get_class_example_catalog] = lambda: catalog
    try:
        with TestClient(app) as client:
            response = client.get("/game/predicted-classes/Mailbox/examples")
            assert response.status_code == 200
            assert response.json() == {
                "label": "mailbox",
                "examples": [
                    {
                        "image_url": "/game/predicted-classes/mailbox/examples/0/image",
                        "source": "Test ImageNet source",
                        "alt": "A roadside mailbox",
                    }
                ],
            }
            image_response = client.get(response.json()["examples"][0]["image_url"])
            assert image_response.status_code == 200
            assert image_response.headers["content-type"] == "image/jpeg"
    finally:
        app.dependency_overrides.pop(get_class_example_catalog, None)


def test_unknown_predicted_class_returns_an_empty_collection(tmp_path: Path) -> None:
    catalog = write_examples(tmp_path / "examples")
    assert catalog.examples_for("shopping cart") == []


def test_missing_local_manifest_keeps_optional_feature_available(tmp_path: Path) -> None:
    assert ClassExampleCatalog(tmp_path / "missing").examples_for("mailbox") == []
