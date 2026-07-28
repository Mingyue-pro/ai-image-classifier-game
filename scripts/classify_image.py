"""Classify one local image with the backend ResNet-34 service."""

import argparse
import json
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from backend.app.inference import ResNet34InferenceService


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Path to a JPEG, PNG, or WebP image")
    args = parser.parse_args()

    try:
        with Image.open(args.image) as image:
            image.load()
            result = ResNet34InferenceService().classify(image)
    except (FileNotFoundError, UnidentifiedImageError, OSError) as error:
        parser.error(f"could not open image: {error}")

    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    main()
