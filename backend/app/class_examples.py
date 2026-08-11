"""Read local representative examples for ImageNet prediction classes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


class ClassExampleCatalogError(ValueError):
    """Raised when the local example manifest or an image entry is invalid."""


class ClassExampleNotFoundError(ClassExampleCatalogError):
    """Raised when a requested example image is not available."""


class ClassExampleCatalog:
    """Resolve a predicted class to explicitly configured local examples."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.manifest_path = self.root / "examples.json"

    def examples_for(self, label: str) -> list[dict[str, str]]:
        normalized_label = self._normalize_label(label)
        raw_examples = self._read_manifest().get(normalized_label, [])
        if not isinstance(raw_examples, list):
            raise ClassExampleCatalogError(
                f"Examples for {normalized_label!r} must be a list"
            )

        examples: list[dict[str, str]] = []
        for index, raw_example in enumerate(raw_examples):
            _, source, alt = self._validate_example(
                normalized_label, index, raw_example
            )
            encoded_label = quote(normalized_label, safe="")
            examples.append(
                {
                    "image_url": (
                        f"/game/predicted-classes/{encoded_label}/examples/"
                        f"{index}/image"
                    ),
                    "source": source,
                    "alt": alt,
                }
            )
        return examples

    def image_path(self, label: str, index: int) -> Path:
        normalized_label = self._normalize_label(label)
        raw_examples = self._read_manifest().get(normalized_label, [])
        if not isinstance(raw_examples, list) or index < 0 or index >= len(raw_examples):
            raise ClassExampleNotFoundError(
                f"Example {index} is not available for {normalized_label!r}"
            )
        image_path, _, _ = self._validate_example(
            normalized_label, index, raw_examples[index]
        )
        return image_path

    def _read_manifest(self) -> dict[str, Any]:
        # Images are deliberately ignored by Git, so this optional teaching aid
        # must remain harmless when a deployment does not have the local files.
        if not self.manifest_path.is_file():
            return {}
        try:
            value = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ClassExampleCatalogError(
                f"Could not read local class examples: {error}"
            ) from error
        if not isinstance(value, dict):
            raise ClassExampleCatalogError("Class example manifest must be an object")
        return {self._normalize_label(str(key)): item for key, item in value.items()}

    def _validate_example(
        self, label: str, index: int, value: Any
    ) -> tuple[Path, str, str]:
        if not isinstance(value, dict):
            raise ClassExampleCatalogError(
                f"Example {index} for {label!r} must be an object"
            )
        relative_path = value.get("image_path")
        source = value.get("source")
        alt = value.get("alt")
        if not all(
            isinstance(item, str) and item.strip()
            for item in (relative_path, source, alt)
        ):
            raise ClassExampleCatalogError(
                f"Example {index} for {label!r} requires image_path, source, and alt"
            )

        path = (self.root / relative_path).resolve()
        if self.root not in path.parents or path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
            raise ClassExampleCatalogError(
                f"Example {index} for {label!r} has an unsafe image path"
            )
        if not path.is_file():
            raise ClassExampleCatalogError(
                f"Example image does not exist: {relative_path}"
            )
        return path, source.strip(), alt.strip()

    @staticmethod
    def _normalize_label(label: str) -> str:
        normalized = " ".join(label.strip().lower().split())
        if not normalized:
            raise ClassExampleCatalogError("Prediction label cannot be empty")
        return normalized
