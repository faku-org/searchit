from __future__ import annotations

import platform
from typing import TYPE_CHECKING

from gpu_lock import GPU_LOCK

if TYPE_CHECKING:
    from PIL.Image import Image

_rapidocr_engine = None


def read_scene_text(image: "Image", min_confidence: float | None = None) -> str:
    """Cross-platform OCR with no GPU and no multi-gigabyte model download:
    OS-native text recognition where the OS ships one for free (Apple Vision
    on macOS, Windows.Media.Ocr on Windows), else a small bundled ONNX OCR
    model (RapidOCR) that runs anywhere onnxruntime does. See ocr.py for the
    separate, higher-quality DeepSeek-OCR-2 tier used instead of this on an
    NVIDIA CUDA box with the `ml` extra installed.

    min_confidence drops low-score per-line detections before joining them
    into the returned text -- only honored on backends that actually expose a
    per-detection score (RapidOCR, Apple Vision's topCandidates confidence).
    Windows.Media.Ocr's public API has no per-word/line confidence at all, so
    it's ignored there.
    """
    system = platform.system()
    if system == "Darwin":
        return _read_with_apple_vision(image, min_confidence)
    if system == "Windows":
        return _read_with_windows_ocr(image)
    return _read_with_rapidocr(image, min_confidence)


def _read_with_windows_ocr(image: "Image") -> str:
    import asyncio
    import io

    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    async def _recognize() -> str:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="PNG")

        stream = InMemoryRandomAccessStream()
        writer = DataWriter(stream)
        writer.write_bytes(buf.getvalue())
        await writer.store_async()
        await writer.flush_async()
        stream.seek(0)

        decoder = await BitmapDecoder.create_async(stream)
        bitmap = await decoder.get_software_bitmap_async()

        engine = OcrEngine.try_create_from_user_profile_languages()
        if engine is None:
            return ""
        result = await engine.recognize_async(bitmap)
        return result.text

    return asyncio.run(_recognize())


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

            _rapidocr_engine = RapidOCR()

        result = _rapidocr_engine(np.array(image.convert("RGB")))

    if result is None or not result.txts:
        return ""
    scores = getattr(result, "scores", None)
    if min_confidence is None or not scores or len(scores) != len(result.txts):
        return "\n".join(result.txts)
    kept = [txt for txt, score in zip(result.txts, scores) if score >= min_confidence]
    return "\n".join(kept)
