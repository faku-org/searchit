from __future__ import annotations

import logging
import math
import random
import sys
import threading
import zlib
from pathlib import Path

import psutil
from fastapi import FastAPI, HTTPException
from PIL import Image, ImageStat
from pydantic import BaseModel

import hardware
from config import get_execution_providers, get_settings, resolve_ocr_backend

logger = logging.getLogger("searchit.inference")

app = FastAPI(title="SearchIt Inference")

_process = psutil.Process()


def _log_rss(tag: str) -> None:
    """Logs this process's resident memory after a real (non-mock) inference
    call, tagged by endpoint, so a batch run's console output shows which
    endpoint's memory keeps climbing rather than just an overall total --
    temporary diagnostics for tracking down a real-world memory leak."""
    rss_mb = _process.memory_info().rss / (1024 * 1024)
    logger.info("[memory] %s: rss=%.1fMB", tag, rss_mb)


def _ocr_model_loaded() -> bool:
    """Whether DeepSeek-OCR-2's weights have actually finished downloading
    and loading into memory -- distinct from resolve_ocr_backend()'s
    ocrActiveBackend, which only reflects whether the tier is *selected* by
    config+hardware, not whether the (lazy, ~6.8GB) load has happened yet.
    Reads ocr.py's module-level cache via sys.modules rather than importing
    it directly: ocr.py pulls in torch/transformers at import time, and
    /health needs to stay cheap for a client that never opted into this
    tier at all."""
    ocr_module = sys.modules.get("ocr")
    return bool(ocr_module is not None and ocr_module._model is not None)


def _warmup_models() -> None:
    """Loads the real onnxruntime models (faces, then CLIP) once at startup,
    off the request-handling threadpool, so the first retry-all batch doesn't
    pay the multi-second load while holding GPU_LOCK and stalling every other
    request behind it. Best-effort: on failure, the affected model just falls
    back to its usual lazy load on first use."""
    try:
        from faces import warmup as warmup_faces

        warmup_faces()
    except Exception:
        logger.exception("Face model warmup failed; will lazy-load on first request")

    try:
        from clip_embed import warmup as warmup_clip

        warmup_clip()
    except Exception:
        logger.exception("CLIP model warmup failed; will lazy-load on first request")


@app.on_event("startup")
def _on_startup() -> None:
    settings = get_settings()
    if settings.inference_mock:
        return
    threading.Thread(target=_warmup_models, daemon=True).start()

FACE_EMBEDDING_DIMENSIONS = 512
MOCK_IDENTITY_CLUSTERS = 5

CLIP_EMBEDDING_DIMENSIONS = 512
COLOR_PROJECTION_SEED = 777

MOCK_COLOR_WORDS = {
    "red": (200, 60, 60),
    "blue": (60, 140, 200),
    "green": (80, 180, 90),
    "black": (20, 20, 20),
    "white": (235, 235, 235),
    "yellow": (230, 210, 60),
    "purple": (140, 90, 180),
    "pink": (230, 140, 180),
    "orange": (230, 140, 60),
    "gray": (130, 130, 130),
    "grey": (130, 130, 130),
}

SCENE_TEXT_PHRASES = [
    "FINISH LINE",
    "SPONSORED BY BANCO X",
    "10K CIUDAD VIEJA",
    "KM 5",
    "RUNNING CLUB MONTEVIDEO",
    "WATER STATION",
    "OFFICIAL TIMING PARTNER",
]


class BoundingBox(BaseModel):
    x: int
    y: int
    width: int
    height: int


class FaceDetection(BaseModel):
    confidence: float
    bbox: BoundingBox
    embedding: list[float]


class DetectFacesRequest(BaseModel):
    imagePath: str


class DetectFacesResponse(BaseModel):
    faces: list[FaceDetection]


class EmbedImageRequest(BaseModel):
    imagePath: str


class EmbedImageResponse(BaseModel):
    embedding: list[float]


class EmbedTextRequest(BaseModel):
    text: str


class EmbedTextResponse(BaseModel):
    embedding: list[float]


class ReadSceneTextRequest(BaseModel):
    imagePath: str
    # Drops low-score per-line OCR detections before joining them into the
    # returned text -- see ocr_native.py's read_scene_text for which backends
    # actually honor this.
    minConfidence: float | None = None


class ReadSceneTextResponse(BaseModel):
    text: str


@app.get("/health")
def health():
    settings = get_settings()
    # Real onnxruntime execution providers actually in use, not just the raw
    # SEARCHIT_DEVICE env string -- lets callers (including the smoke test in
    # scripts/smoke-test-sidecars.mjs) confirm e.g. CoreML was really selected
    # on macOS rather than silently falling back to CPU.
    providers = [] if settings.inference_mock else get_execution_providers()
    deepseek_device = None if settings.inference_mock else resolve_ocr_backend()
    return {
        "ok": True,
        "mock": settings.inference_mock,
        "device": settings.searchit_device,
        "providers": providers,
        "ocrTier": settings.ocr_tier,
        # The backend actually in effect right now (None means the native/
        # ONNX tier), plus what the detector thinks this box could support if
        # weights were configured -- lets the client show "your GPU supports
        # the high-quality OCR tier" even before the user opts in.
        "ocrActiveBackend": deepseek_device,
        # False even while ocrActiveBackend is "cuda"/"mps" means the tier is
        # selected but the weights haven't been downloaded/loaded yet --
        # that happens lazily on the first photo actually OCR'd after
        # enabling the setting, which can take a while for the ~6.8GB
        # download.
        "ocrModelLoaded": _ocr_model_loaded(),
        "ocrCapability": {
            "cuda": hardware.cuda_capable(),
            "cudaVramGB": hardware.detect_nvidia_vram_gb(),
            "mps": hardware.mps_capable(),
            "macUnifiedMemoryGB": hardware.detect_mac_unified_memory_gb(),
        },
    }


@app.post("/detect-faces", response_model=DetectFacesResponse)
def detect_faces_endpoint(body: DetectFacesRequest) -> DetectFacesResponse:
    settings = get_settings()
    image_path = Path(body.imagePath)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {body.imagePath}")

    if settings.inference_mock:
        return _mock_faces(image_path)
    return _real_faces(image_path)


@app.post("/embed-image", response_model=EmbedImageResponse)
def embed_image_endpoint(body: EmbedImageRequest) -> EmbedImageResponse:
    settings = get_settings()
    image_path = Path(body.imagePath)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {body.imagePath}")

    if settings.inference_mock:
        return EmbedImageResponse(embedding=_mock_image_embedding(image_path))

    from clip_embed import embed_image

    with Image.open(image_path) as img:
        embedding = embed_image(img.convert("RGB"))
    _log_rss("embed-image")
    return EmbedImageResponse(embedding=embedding)


@app.post("/embed-text", response_model=EmbedTextResponse)
def embed_text_endpoint(body: EmbedTextRequest) -> EmbedTextResponse:
    settings = get_settings()

    if settings.inference_mock:
        return EmbedTextResponse(embedding=_mock_text_embedding(body.text))

    from clip_embed import embed_text

    return EmbedTextResponse(embedding=embed_text(body.text))


@app.post("/read-scene-text", response_model=ReadSceneTextResponse)
def read_scene_text_endpoint(body: ReadSceneTextRequest) -> ReadSceneTextResponse:
    settings = get_settings()
    image_path = Path(body.imagePath)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {body.imagePath}")

    if settings.inference_mock:
        return ReadSceneTextResponse(text=_mock_scene_text(image_path))

    deepseek_device = resolve_ocr_backend()
    if deepseek_device is not None:
        from ocr import read_scene_text

        with Image.open(image_path) as img:
            text = read_scene_text(
                img.convert("RGB"), min_confidence=body.minConfidence, device=deepseek_device
            )
        _log_rss("read-scene-text")
        return ReadSceneTextResponse(text=text)

    from ocr_native import read_scene_text

    with Image.open(image_path) as img:
        text = read_scene_text(img.convert("RGB"), min_confidence=body.minConfidence)
    _log_rss("read-scene-text")
    return ReadSceneTextResponse(text=text)


def _canonical_mock_embedding(cluster_id: int) -> list[float]:
    """A fixed pseudo-random 512-dim vector per cluster id, regenerated deterministically
    (not cached) since it's cheap and keeps this stateless."""
    rng = random.Random(1000 + cluster_id)
    return [rng.gauss(0, 1) for _ in range(FACE_EMBEDDING_DIMENSIONS)]


def _mock_embedding(cluster_id: int, noise_seed: int) -> list[float]:
    """Small Gaussian noise around a canonical cluster vector, then L2-normalized (matching
    real ArcFace convention). Different clusters are near-orthogonal in 512 dims, so this mock
    is actually cluster-able end to end, unlike pure-random-per-photo embeddings would be."""
    base = _canonical_mock_embedding(cluster_id)
    noise_rng = random.Random(noise_seed)
    noisy = [v + noise_rng.gauss(0, 0.05) for v in base]
    norm = math.sqrt(sum(v * v for v in noisy)) or 1.0
    return [v / norm for v in noisy]


def _mock_faces(image_path: Path) -> DetectFacesResponse:
    """Deterministic-per-filename fake faces, reusing a small set of canonical "mock people"
    across different filenames so cross-photo identity matching is testable without GPU weights."""
    with Image.open(image_path) as img:
        width, height = img.size

    rng = random.Random(zlib.crc32(image_path.name.encode()))

    if rng.random() < 0.15:
        return DetectFacesResponse(faces=[])

    face_count = rng.choice([1, 1, 1, 2])
    faces: list[FaceDetection] = []
    for face_index in range(face_count):
        cluster_id = (
            zlib.crc32(f"{image_path.name}:{face_index}".encode()) % MOCK_IDENTITY_CLUSTERS
        )
        noise_seed = zlib.crc32(f"{image_path.name}:{face_index}:noise".encode())

        box_width = max(width // 8, 60)
        box_height = max(height // 6, 60)
        x = rng.randint(0, max(width - box_width, 0))
        y = rng.randint(0, max(height // 3, 1))

        faces.append(
            FaceDetection(
                confidence=round(rng.uniform(0.85, 0.99), 2),
                bbox=BoundingBox(x=x, y=y, width=box_width, height=box_height),
                embedding=_mock_embedding(cluster_id, noise_seed),
            )
        )

    return DetectFacesResponse(faces=faces)


def _real_faces(image_path: Path) -> DetectFacesResponse:
    from faces import detect_faces

    with Image.open(image_path) as img:
        img = img.convert("RGB")
        results = detect_faces(img)

    _log_rss("detect-faces")
    return DetectFacesResponse(
        faces=[
            FaceDetection(
                confidence=result.confidence,
                bbox=BoundingBox(
                    x=result.bbox[0],
                    y=result.bbox[1],
                    width=result.bbox[2],
                    height=result.bbox[3],
                ),
                embedding=result.embedding,
            )
            for result in results
        ]
    )


def _color_projection_matrix() -> list[list[float]]:
    rng = random.Random(COLOR_PROJECTION_SEED)
    return [[rng.gauss(0, 1) for _ in range(3)] for _ in range(CLIP_EMBEDDING_DIMENSIONS)]


def _project_color(rgb: tuple[float, float, float]) -> list[float]:
    matrix = _color_projection_matrix()
    normalized = tuple(c / 255 for c in rgb)
    raw = [sum(row[i] * normalized[i] for i in range(3)) for row in matrix]
    norm = math.sqrt(sum(v * v for v in raw)) or 1.0
    return [v / norm for v in raw]


def _mock_image_embedding(image_path: Path) -> list[float]:
    """Real CLIP embeds semantics; this mock only fakes color, by projecting the photo's
    actual average RGB through a fixed random matrix. Crude, but it means mock "visual
    search" genuinely responds to what's in the test photo instead of being pure noise."""
    with Image.open(image_path) as img:
        stat = ImageStat.Stat(img.convert("RGB"))
    return _project_color(tuple(stat.mean))


def _mock_text_embedding(text: str) -> list[float]:
    lowered = text.lower()
    for word, rgb in MOCK_COLOR_WORDS.items():
        if word in lowered:
            return _project_color(rgb)

    # No recognized color word: still deterministic, but not meaningfully matchable to
    # any particular mock photo (there's no real semantic understanding here).
    rng = random.Random(zlib.crc32(text.encode()))
    raw = [rng.gauss(0, 1) for _ in range(CLIP_EMBEDDING_DIMENSIONS)]
    norm = math.sqrt(sum(v * v for v in raw)) or 1.0
    return [v / norm for v in raw]


def _mock_scene_text(image_path: Path) -> str:
    rng = random.Random(zlib.crc32(f"scene:{image_path.name}".encode()))

    # Real photos frequently have no legible scene text at all -- match that
    # here (same ~15% empty rate as _mock_faces/_mock_detections) instead of
    # inventing a phrase for every single photo.
    if rng.random() < 0.15:
        return ""

    phrase_count = rng.choice([1, 1, 2])
    return " / ".join(
        rng.sample(SCENE_TEXT_PHRASES, k=min(phrase_count, len(SCENE_TEXT_PHRASES)))
    )
