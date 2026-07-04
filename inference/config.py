import platform
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    inference_mock: bool = True
    searchit_device: str = "cpu"
    ocr_model_path: str | None = None
    ocr_scratch_dir: str = "./.ocr_scratch"
    model_cache_dir: str = "./.model_cache"
    face_det_thresh: float = 0.6
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()


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
