from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import torch

from config import get_settings

if TYPE_CHECKING:
    from PIL.Image import Image

_model = None
_tokenizer = None

# "Free OCR." skips the markdown/grounding layout DeepSeek-OCR-2 targets for full
# documents -- we only want the raw text visible in the frame.
OCR_PROMPT = "<image>\nFree OCR. "

# On images with no legible text (a blank crop, a solid-color background), the
# model sometimes answers conversationally instead of returning empty --
# e.g. "I am sorry, but the image provided is a graphic design and not a data
# chart." Treat that class of response as "no text found" rather than storing
# the model's commentary as if it were the photo's actual recognized text.
_REFUSAL_MARKERS = (
    "i am sorry",
    "i'm sorry",
    "i cannot",
    "i can't",
    "as an ai",
    "i don't see any text",
    "i do not see any text",
    "no text is present",
    "does not contain any",
    "doesn't contain any",
)


def _discard_if_refusal(text: str) -> str:
    lowered = text.lower()
    if any(marker in lowered for marker in _REFUSAL_MARKERS):
        return ""
    return text


def _flash_attention_available() -> bool:
    """flash-attn needs a matching CUDA toolchain to build and has no official
    Windows wheels, so it's an opt-in extra (see README) rather than a hard
    dependency -- fall back to eager attention when it isn't installed instead
    of asking transformers to load a module that isn't there. CUDA-only: there
    is no MPS build of flash-attn, so MPS always uses eager attention."""
    try:
        import flash_attn  # noqa: F401
    except ImportError:
        return False
    return True


def _load_model(device: str):
    global _model, _tokenizer
    if _model is not None:
        return _model, _tokenizer

    from transformers import AutoModel, AutoTokenizer

    settings = get_settings()
    if not settings.ocr_model_path:
        raise RuntimeError(
            "OCR_MODEL_PATH is not set (point it at deepseek-ai/DeepSeek-OCR-2 "
            "weights, or a local checkout of them)."
        )

    use_flash_attention = device == "cuda" and _flash_attention_available()
    _tokenizer = AutoTokenizer.from_pretrained(
        settings.ocr_model_path, trust_remote_code=True
    )
    model = AutoModel.from_pretrained(
        settings.ocr_model_path,
        trust_remote_code=True,
        use_safetensors=True,
        _attn_implementation="flash_attention_2" if use_flash_attention else "eager",
    )
    model = model.eval().to(device)
    if device != "cpu":
        # bfloat16 matches the model card's recommended dtype. Unverified on
        # real Apple Silicon hardware -- MPS bfloat16 op coverage has
        # historically lagged CUDA's; if this errors out on a real Mac, the
        # fallback is switching this branch to torch.float16 for device=="mps".
        model = model.to(torch.bfloat16)
    _model = model
    return _model, _tokenizer


def read_text(image: "Image", device: str = "cuda") -> str:
    """
    Runs DeepSeek-OCR-2 on an image and returns the raw recognized text.

    model.infer() is file-path based per the deepseek-ai/DeepSeek-OCR-2 model
    card, and its return value isn't consistently documented across examples --
    some treat it as the recognized text directly, others only rely on the
    text file it writes under output_path. This handles both: it prefers a
    non-empty string return and falls back to reading whatever .txt/.mmd file
    shows up in the scratch output dir. Re-verify against the installed model
    version once real weights are in place.
    """
    model, tokenizer = _load_model(device)
    settings = get_settings()

    scratch_dir = Path(settings.ocr_scratch_dir)
    scratch_dir.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex
    image_path = scratch_dir / f"{run_id}.jpg"
    output_dir = scratch_dir / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    image.save(image_path)

    try:
        # Inference only, never trained here -- without this, every call
        # builds and retains a full autograd graph for nothing, which is a
        # large, needless memory cost across a batch of many photos.
        with torch.no_grad():
            result = model.infer(
                tokenizer,
                prompt=OCR_PROMPT,
                image_file=str(image_path),
                output_path=str(output_dir),
                base_size=1024,
                # DeepSeek-OCR-2's encoder only supports two tile sizes -- 768
                # (144 visual tokens) or 1024 (256 visual tokens), per its own
                # "Support-Modes" doc. Anything else (640, the model's own
                # default) hits an unguarded branch in deepencoderv2.py's
                # Qwen2Decoder2Encoder.forward and crashes with an
                # UnboundLocalError on `param_img`. 768 here matches the tile
                # size dynamic_preprocess() hardcodes internally when
                # crop_mode is on, so the two stay in sync.
                image_size=768,
                # crop_mode=True splits any image bigger than 768x768 into up
                # to 6 tiles (plus a downsampled global view) instead of
                # squeezing the whole frame into a single 768x768 encoder
                # input. Without it, a bib number that's large and legible in
                # a multi-thousand-pixel source photo can still get crushed
                # past readability once the *entire* scene is downsampled to
                # 768px -- exactly the class of miss sports-mode/higher-res
                # OCR sourcing were meant to prevent.
                crop_mode=True,
                save_results=True,
            )

        if isinstance(result, str) and result.strip():
            return _discard_if_refusal(result.strip())

        for candidate in sorted(output_dir.glob("*.txt")) + sorted(
            output_dir.glob("*.mmd")
        ):
            text = candidate.read_text(encoding="utf-8").strip()
            if text:
                return _discard_if_refusal(text)

        return ""
    finally:
        image_path.unlink(missing_ok=True)
        # save_results=True writes text/markdown/visualization output here per
        # call -- nothing downstream needs it once we've read the text above,
        # and leaving it meant every photo in a batch left its output
        # directory behind on disk permanently.
        shutil.rmtree(output_dir, ignore_errors=True)


def read_scene_text(
    image: "Image", min_confidence: float | None = None, device: str = "cuda"
) -> str:
    """Alias for read_text, named for its call site: general scene text
    (banners, signs, boards) from the full frame. min_confidence is accepted
    for call-site parity with ocr_native.read_scene_text but unused here --
    DeepSeek-OCR-2 returns free text with no per-detection score to filter."""
    return read_text(image, device=device)
