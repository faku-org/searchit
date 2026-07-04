from __future__ import annotations

from typing import TYPE_CHECKING

from config import get_settings

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
    ctx_id = 0 if settings.searchit_device == "cuda" else -1

    face_app = FaceAnalysis(name="buffalo_l")
    face_app.prepare(
        ctx_id=ctx_id, det_size=(640, 640), det_thresh=settings.face_det_thresh
    )
    _app = face_app
    return _app


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

    app = _load_app()
    # insightface/onnxruntime expects BGR ndarrays (it's built on cv2 conventions).
    bgr = np.array(image.convert("RGB"))[:, :, ::-1]
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
