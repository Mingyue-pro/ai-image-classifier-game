"""
Define the format and data of the JSON returned by the API
"""
from pydantic import BaseModel, Field


class Prediction(BaseModel):
    label: str
    probability: float = Field(ge=0.0, le=1.0)
    class_index: int = Field(ge=0)


class ClassificationResponse(BaseModel):
    model_name: str
    weights_name: str
    top1: Prediction
    top5: list[Prediction]
