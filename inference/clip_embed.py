from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from config import get_execution_providers, get_settings

if TYPE_CHECKING:
    from PIL.Image import Image

# A pre-exported ONNX build of CLIP (github.com/huggingface/transformers.js
# community models), used instead of the original torch checkpoint so this
# runs on plain onnxruntime -- no torch/CUDA needed on the desktop client.
# The quantized (int8) variant trades a little accuracy for a ~150MB total
# download instead of ~600MB fp32.
CLIP_REPO_ID = "Xenova/clip-vit-base-patch32"
CLIP_FILES = (
    "onnx/vision_model_quantized.onnx",
    "onnx/text_model_quantized.onnx",
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
)

_vision_session = None
_text_session = None
_processor = None
_tokenizer = None


def _load():
    global _vision_session, _text_session, _processor, _tokenizer
    if _vision_session is not None:
        return

    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from transformers import CLIPImageProcessor, CLIPTokenizerFast

    settings = get_settings()
    providers = get_execution_providers()

    local_paths = {
        filename: hf_hub_download(
            repo_id=CLIP_REPO_ID,
            filename=filename,
            cache_dir=settings.model_cache_dir,
        )
        for filename in CLIP_FILES
    }
    config_dir = str(Path(local_paths["preprocessor_config.json"]).parent)

    _vision_session = ort.InferenceSession(
        local_paths["onnx/vision_model_quantized.onnx"], providers=providers
    )
    _text_session = ort.InferenceSession(
        local_paths["onnx/text_model_quantized.onnx"], providers=providers
    )
    _processor = CLIPImageProcessor.from_pretrained(config_dir)
    _tokenizer = CLIPTokenizerFast.from_pretrained(config_dir)


def embed_image(image: "Image") -> list[float]:
    _load()
    inputs = _processor(images=image, return_tensors="np")
    (embeds,) = _vision_session.run(
        ["image_embeds"],
        {"pixel_values": inputs["pixel_values"].astype("float32")},
    )
    return embeds[0].tolist()


def embed_text(text: str) -> list[float]:
    _load()
    inputs = _tokenizer([text], return_tensors="np")
    input_names = {i.name for i in _text_session.get_inputs()}
    feed = {name: value for name, value in inputs.items() if name in input_names}
    (embeds,) = _text_session.run(["text_embeds"], feed)
    return embeds[0].tolist()
