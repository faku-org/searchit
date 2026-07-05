import logging
import platform
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

import hardware

logger = logging.getLogger("searchit.inference")

OcrTier = Literal["auto", "native", "deepseek"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    inference_mock: bool = True
    searchit_device: str = "cpu"
    ocr_model_path: str | None = None
    # "auto" (default) uses DeepSeek-OCR-2 only when weights are configured
    # AND the detected hardware looks capable of running it well (see
    # resolve_ocr_backend below) -- it never triggers the ~6.8GB weight
    # download by itself, since OCR_MODEL_PATH being unset already means
    # "auto" falls back to the native/ONNX tier exactly like before this
    # setting existed. "native"/"deepseek" force a tier regardless of
    # detected capability.
    ocr_tier: OcrTier = "auto"
    ocr_scratch_dir: str = "./.ocr_scratch"
    model_cache_dir: str = "./.model_cache"
    face_det_thresh: float = 0.6
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def resolve_ocr_backend() -> str | None:
    """Decides which OCR backend `/read-scene-text` should use: None means
    the native/ONNX tier (ocr_native.py), "cuda"/"mps" means DeepSeek-OCR-2
    (ocr.py) on that torch device. See Settings.ocr_tier's docstring for why
    "auto" never triggers the weight download by itself.
    """
    settings = get_settings()

    if settings.ocr_tier == "native":
        return None

    if not settings.ocr_model_path:
        if settings.ocr_tier == "deepseek":
            logger.warning(
                "OCR_TIER=deepseek but OCR_MODEL_PATH is unset -- falling back to native OCR."
            )
        return None

    try:
        import torch
    except ImportError:
        if settings.ocr_tier == "deepseek":
            logger.warning(
                "OCR_TIER=deepseek but torch isn't installed (`uv sync --extra ml`) "
                "-- falling back to native OCR."
            )
        return None

    cuda_available = torch.cuda.is_available()
    mps_available = torch.backends.mps.is_available()

    if settings.ocr_tier == "deepseek":
        # Forced: still prefer a real accelerator over CPU (which would be
        # painfully slow for a multi-GB transformer), but respect the
        # explicit choice even if detected VRAM/memory looks thin.
        if cuda_available:
            return "cuda"
        if mps_available:
            return "mps"
        logger.warning(
            "OCR_TIER=deepseek but no CUDA/MPS device is available -- falling back to native OCR."
        )
        return None

    # "auto": only prefer DeepSeek when the hardware looks comfortably
    # capable, not just "technically available" -- an underpowered GPU would
    # make OCR the slowest part of the pipeline for no accuracy win worth it.
    if cuda_available and hardware.cuda_capable():
        return "cuda"
    if mps_available and hardware.mps_capable():
        return "mps"
    return None


@lru_cache
def get_execution_providers() -> list[str]:
    """Orders onnxruntime execution providers by preference and keeps only
    the ones the installed onnxruntime build actually exposes, so faces.py
    and clip_embed.py run on whatever real on-device accelerator is
    available -- Neural Engine/GPU via CoreML on macOS, any DX12 GPU via
    DirectML on Windows, NVIDIA CUDA if that's the onnxruntime variant
    installed (the `ml` extra's GPU box) -- and fall back to CPU everywhere
    else. See inference/pyproject.toml for which onnxruntime distribution
    ships which providers.
    """
    import onnxruntime as ort

    available = set(ort.get_available_providers())
    platform_preferred = {
        "Darwin": "CoreMLExecutionProvider",
        "Windows": "DmlExecutionProvider",
    }.get(platform.system())

    ordered = ["CUDAExecutionProvider"]
    if platform_preferred:
        ordered.append(platform_preferred)
    ordered.append("CPUExecutionProvider")

    providers = [p for p in ordered if p in available]
    return providers or ["CPUExecutionProvider"]
