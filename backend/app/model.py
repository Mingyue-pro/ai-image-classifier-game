"""
Responsible for model configuration and loading:
 1. Specify the model name
 2. Specify the official weight
 3. Create ResNet-34
 4. Set evaluation mode
 5. Cache the model
"""
from functools import lru_cache

import torch
from torchvision.models import ResNet34_Weights, resnet34


MODEL_NAME = "resnet34"
WEIGHTS = ResNet34_Weights.DEFAULT


@lru_cache(maxsize=1)
def load_model() -> torch.nn.Module:
    """Load the pretrained model once per Python process."""
    model = resnet34(weights=WEIGHTS)
    model.to(torch.device("cpu"))
    model.eval()
    return model
