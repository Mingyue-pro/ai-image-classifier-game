"""
Core image classification responsibilities:
 1. accept Pillow picture
 2. convert to RGB
 3. Use the preprocessing transforms provided by the official weights
 4. Run the model
 5. Convert logits to probabilities
 6. Identify the Top-5
 7. Construct API response
"""
from typing import Protocol

import torch
from PIL import Image

from backend.app.model import MODEL_NAME, WEIGHTS, load_model
from backend.app.schemas import ClassificationResponse, Prediction


class ImageClassifier(Protocol):
    def classify(self, image: Image.Image) -> ClassificationResponse: ...


class ResNet34InferenceService:
    def __init__(self) -> None:
        self.device = torch.device("cpu")
        self.preprocess = WEIGHTS.transforms()
        self.categories = WEIGHTS.meta["categories"]

    def classify(self, image: Image.Image) -> ClassificationResponse:
        rgb_image = image.convert("RGB")
        # Add a batch dimension because the model expects N × C × H × W input
        batch = self.preprocess(rgb_image).unsqueeze(0).to(self.device)
        model = load_model()

        with torch.inference_mode():
            logits = model(batch)
            probabilities = torch.nn.functional.softmax(logits[0], dim=0)

        top_probabilities, top_indices = probabilities.topk(5)
        top5 = [
            Prediction(
                label=self.categories[class_index],
                probability=float(probability),
                class_index=class_index,
            )
            for probability, class_index in zip(
                top_probabilities.tolist(), top_indices.tolist(), strict=True
            )
        ]

        return ClassificationResponse(
            model_name=MODEL_NAME,
            weights_name=WEIGHTS.name,
            top1=top5[0],
            top5=top5,
        )
