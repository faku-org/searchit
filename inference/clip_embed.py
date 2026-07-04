from __future__ import annotations

from typing import TYPE_CHECKING

from config import get_settings

if TYPE_CHECKING:
    from PIL.Image import Image

CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"

_model = None
_processor = None


def _device() -> str:
    settings = get_settings()
    return settings.searchit_device if settings.searchit_device == "cuda" else "cpu"


def _load_model():
    global _model, _processor
    if _model is not None:
        return _model, _processor

    from transformers import CLIPModel, CLIPProcessor

    model = CLIPModel.from_pretrained(CLIP_MODEL_NAME).to(_device())
    model.eval()
    _model = model
    _processor = CLIPProcessor.from_pretrained(CLIP_MODEL_NAME)
    return _model, _processor


def embed_image(image: "Image") -> list[float]:
    import torch

    model, processor = _load_model()
    inputs = processor(images=image, return_tensors="pt").to(_device())
    with torch.no_grad():
        features = model.get_image_features(**inputs)
    return features[0].tolist()


def embed_text(text: str) -> list[float]:
    import torch

    model, processor = _load_model()
    inputs = processor(text=[text], return_tensors="pt", padding=True).to(_device())
    with torch.no_grad():
        features = model.get_text_features(**inputs)
    return features[0].tolist()
