from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    inference_mock: bool = True
    searchit_device: str = "cpu"
    ocr_model_path: str | None = None
    ocr_scratch_dir: str = "./.ocr_scratch"
    face_det_thresh: float = 0.6
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()
