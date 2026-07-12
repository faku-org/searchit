from __future__ import annotations

import platform
from typing import TYPE_CHECKING

from gpu_lock import GPU_LOCK

if TYPE_CHECKING:
    from PIL.Image import Image

_rapidocr_engine = None


def read_scene_text(image: "Image", min_confidence: float | None = None) -> str:
    """Cross-platform OCR with no GPU required and no multi-gigabyte model
    download: Apple Vision on macOS (OS-native, free), else a small bundled
    ONNX OCR model (RapidOCR) that runs anywhere onnxruntime does -- including
    Windows, where Windows.Media.Ocr used to be the default until testing
    showed it missing small, angled bib numbers on race photos that RapidOCR
    reads correctly (see git history around "sports mode"). RapidOCR opts
    into whichever onnxruntime execution provider config.get_execution_providers
    picks (DirectML on Windows, CUDA on the `ml` extra's box), same as
    faces.py/clip_embed.py, so it isn't CPU-only either. See ocr.py for the
    separate, higher-quality DeepSeek-OCR-2 tier used instead of this on an
    NVIDIA CUDA box with the `ml` extra installed.

    min_confidence drops low-score per-line detections before joining them
    into the returned text -- only honored on backends that actually expose a
    per-detection score (RapidOCR, Apple Vision's topCandidates confidence).
    """
    if platform.system() == "Darwin":
        return _read_with_apple_vision(image, min_confidence)
    return _read_with_rapidocr(image, min_confidence)


def _read_with_apple_vision(image: "Image", min_confidence: float | None = None) -> str:
    # Untestable on this project's Windows dev machine -- written against
    # Apple's documented Vision APIs (VNRecognizeTextRequest /
    # VNImageRequestHandler) via pyobjc-framework-Vision/-Quartz. Re-verify
    # on a real Mac before relying on it.
    import io

    import Quartz
    import Vision
    from Foundation import NSData

    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    data = NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
    provider = Quartz.CGDataProviderCreateWithCFData(data)
    cg_image = Quartz.CGImageCreateWithPNGDataProvider(
        provider, None, False, Quartz.kCGRenderingIntentDefault
    )

    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(
        cg_image, None
    )
    request = Vision.VNRecognizeTextRequest.alloc().init()

    success, error = handler.performRequests_error_([request], None)
    if not success or error:
        return ""

    lines: list[str] = []
    for observation in request.results():
        candidates = observation.topCandidates_(1)
        if not candidates:
            continue
        candidate = candidates[0]
        if min_confidence is not None and candidate.confidence() < min_confidence:
            continue
        lines.append(str(candidate.string()))
    return "\n".join(lines)


def _read_with_rapidocr(image: "Image", min_confidence: float | None = None) -> str:
    global _rapidocr_engine
    import numpy as np

    with GPU_LOCK:
        if _rapidocr_engine is None:
            from rapidocr import RapidOCR

            from config import get_execution_providers

            # RapidOCR ships its own onnxruntime engine config, defaulting
            # every accelerator flag (use_cuda/use_dml) to False -- left at
            # defaults it always ran on CPU regardless of which onnxruntime
            # wheel (plain/-directml/-gpu) was actually installed. Wiring it
            # to the same provider detection faces.py/clip_embed.py use
            # (config.get_execution_providers) lets it pick up DirectML on
            # Windows or CUDA on the `ml` extra's box, same as those. No
            # use_coreml here: read_scene_text() routes macOS to Apple Vision
            # before this function ever runs.
            providers = get_execution_providers()
            _rapidocr_engine = RapidOCR(
                params={
                    "EngineConfig.onnxruntime.use_cuda": "CUDAExecutionProvider" in providers,
                    "EngineConfig.onnxruntime.use_dml": "DmlExecutionProvider" in providers,
                }
            )

        result = _rapidocr_engine(np.array(image.convert("RGB")))

    if result is None or not result.txts:
        return ""
    scores = getattr(result, "scores", None)
    if min_confidence is None or not scores or len(scores) != len(result.txts):
        return "\n".join(result.txts)
    kept = [txt for txt, score in zip(result.txts, scores) if score >= min_confidence]
    return "\n".join(kept)
