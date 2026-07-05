from __future__ import annotations

import threading
from pathlib import Path
from typing import TYPE_CHECKING

from config import get_execution_providers, get_settings
from gpu_lock import GPU_LOCK

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


def _clip_execution_providers() -> list[str]:
    """DmlExecutionProvider crashes onnxruntime outright (native access
    violation, exit code 0xC0000005) while *creating* an InferenceSession for
    this repo's quantized vision graph (onnx/vision_model_quantized.onnx) --
    reproduced deterministically and single-threaded, with no other model or
    thread involved, in a clean venv containing only onnxruntime-directml.
    It isn't a concurrency race (see gpu_lock.py for the actual race that
    GPU_LOCK guards against elsewhere) -- DirectML's kernel support for this
    particular int8-quantized graph's ops appears to be broken outright on
    this box. CLIP's models are tiny next to face detection's, so CPU
    inference is ~30ms/image / ~5ms/text anyway -- not worth risking a crash
    for. Only DirectML is excluded: CUDA (the `ml` extra) and CoreML (macOS)
    haven't shown this failure and keep their acceleration.
    """
    return [p for p in get_execution_providers() if p != "DmlExecutionProvider"] or [
        "CPUExecutionProvider"
    ]

# Guards only the one-time model load (a plain check-then-set race
# otherwise) -- the actual inference calls in embed_image/embed_text share
# GPU_LOCK with every other model in the process (see gpu_lock.py): per-model
# locks weren't enough on their own, DirectML sessions from different models
# still crashed the sidecar when invoked from overlapping threads.
_load_lock = threading.Lock()


def _load():
    global _vision_session, _text_session, _processor, _tokenizer
    if _vision_session is not None:
        return

    with _load_lock:
        if _vision_session is not None:
            return

        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from transformers import CLIPImageProcessor, CLIPTokenizerFast

        settings = get_settings()
        providers = _clip_execution_providers()

        local_paths = {
            filename: hf_hub_download(
                repo_id=CLIP_REPO_ID,
                filename=filename,
                cache_dir=settings.model_cache_dir,
            )
            for filename in CLIP_FILES
        }
        config_dir = str(Path(local_paths["preprocessor_config.json"]).parent)

        # Session creation doesn't need GPU_LOCK for correctness on its own,
        # but grouping it with the rest of the one-time load under the same
        # lock as every other model's load/inference keeps the "at most one
        # onnxruntime call touches the GPU at a time" invariant simple to
        # reason about, for negligible cost (this only runs once).
        with GPU_LOCK:
            vision_session = ort.InferenceSession(
                local_paths["onnx/vision_model_quantized.onnx"], providers=providers
            )
            text_session = ort.InferenceSession(
                local_paths["onnx/text_model_quantized.onnx"], providers=providers
            )
        _processor = CLIPImageProcessor.from_pretrained(config_dir)
        _tokenizer = CLIPTokenizerFast.from_pretrained(config_dir)
        # Assigned last, and only once everything else has succeeded: the
        # is-loaded check above tests _vision_session, so a failed load
        # never leaves it looking "ready" with the other globals unset.
        _text_session = text_session
        _vision_session = vision_session


def warmup() -> None:
    """Pays the one-time model load (HF download/cache check + DirectML
    session creation) at startup instead of on the first real request, so a
    burst of concurrent retries doesn't stall behind it while holding
    GPU_LOCK. Safe to call multiple times; _load() is idempotent."""
    _load()


def embed_image(image: "Image") -> list[float]:
    _load()
    inputs = _processor(images=image, return_tensors="np")
    with GPU_LOCK:
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
    with GPU_LOCK:
        (embeds,) = _text_session.run(["text_embeds"], feed)
    return embeds[0].tolist()
