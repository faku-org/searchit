from __future__ import annotations

from typing import TYPE_CHECKING

from config import get_execution_providers, get_settings
from gpu_lock import GPU_LOCK

if TYPE_CHECKING:
    from PIL.Image import Image

FACE_EMBEDDING_DIMENSIONS = 512

_app = None


def _load_app():
    global _app
    if _app is not None:
        return _app

    from insightface.app import FaceAnalysis

    settings = get_settings()
    # insightface runs on onnxruntime already, so real on-device acceleration
    # (Neural Engine/GPU via CoreML on macOS, any DX12 GPU via DirectML on
    # Windows, CUDA on the `ml` extra's NVIDIA box) is just a matter of which
    # providers we hand it -- see config.get_execution_providers.
    providers = get_execution_providers()
    ctx_id = -1 if providers == ["CPUExecutionProvider"] else 0

    face_app = FaceAnalysis(
        name="buffalo_l",
        root=settings.model_cache_dir,
        providers=providers,
    )
    face_app.prepare(
        ctx_id=ctx_id, det_size=(640, 640), det_thresh=settings.face_det_thresh
    )
    _app = face_app
    return _app


def warmup() -> None:
    """Pays the one-time InsightFace model load (onnx downloads + DirectML
    session prepare) at startup instead of on the first real request. Mirrors
    clip_embed.warmup(); see that docstring for why."""
    with GPU_LOCK:
        _load_app()


class FaceResult:
    __slots__ = ("bbox", "confidence", "embedding")

    def __init__(
        self,
        bbox: tuple[int, int, int, int],
        confidence: float,
        embedding: list[float],
    ) -> None:
        self.bbox = bbox
        self.confidence = confidence
        self.embedding = embedding


def detect_faces(image: "Image") -> list[FaceResult]:
    """Returns detected faces as (x, y, width, height) boxes with a 512-dim ArcFace embedding."""
    import numpy as np

    # insightface/onnxruntime expects BGR ndarrays (it's built on cv2 conventions).
    bgr = np.array(image.convert("RGB"))[:, :, ::-1]
    with GPU_LOCK:
        app = _load_app()
        faces = app.get(bgr)

    results: list[FaceResult] = []
    for face in faces:
        x1, y1, x2, y2 = face.bbox.astype(int).tolist()
        results.append(
            FaceResult(
                bbox=(x1, y1, x2 - x1, y2 - y1),
                confidence=float(face.det_score),
                embedding=face.embedding.tolist(),
            )
        )
    return results
