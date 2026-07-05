from __future__ import annotations

import platform
from typing import TYPE_CHECKING

from gpu_lock import GPU_LOCK

if TYPE_CHECKING:
    from PIL.Image import Image

_rapidocr_engine = None
_windows_ocr_engine = None
_windows_ocr_engine_loaded = False


def read_scene_text(image: "Image") -> str:
    """Cross-platform OCR with no GPU and no multi-gigabyte model download:
    OS-native text recognition where the OS ships one for free (Apple Vision
    on macOS, Windows.Media.Ocr on Windows), else a small bundled ONNX OCR
    model (RapidOCR) that runs anywhere onnxruntime does. See ocr.py for the
    separate, higher-quality DeepSeek-OCR-2 tier used instead of this on an
    NVIDIA CUDA box with the `ml` extra installed.
    """
    system = platform.system()
    if system == "Darwin":
        return _read_with_apple_vision(image)
    if system == "Windows":
        return _read_with_windows_ocr(image)
    return _read_with_rapidocr(image)


def _get_windows_ocr_engine():
    # Recreating OcrEngine per call (as this used to) churns a WinRT/COM
    # object on every photo in a batch instead of once -- unlike every other
    # engine in this module/service, which is cached as a singleton.
    global _windows_ocr_engine, _windows_ocr_engine_loaded
    if not _windows_ocr_engine_loaded:
        from winsdk.windows.media.ocr import OcrEngine

        _windows_ocr_engine = OcrEngine.try_create_from_user_profile_languages()
        _windows_ocr_engine_loaded = True
    return _windows_ocr_engine


def _read_with_windows_ocr(image: "Image") -> str:
    import asyncio
    import io

    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    engine = _get_windows_ocr_engine()
    if engine is None:
        return ""

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

        result = await engine.recognize_async(bitmap)
        return result.text

    return asyncio.run(_recognize())


def _read_with_apple_vision(image: "Image") -> str:
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
        if candidates:
            lines.append(str(candidates[0].string()))
    return "\n".join(lines)


def _read_with_rapidocr(image: "Image") -> str:
    global _rapidocr_engine
    import numpy as np

    with GPU_LOCK:
        if _rapidocr_engine is None:
            from rapidocr import RapidOCR

            _rapidocr_engine = RapidOCR()

        result = _rapidocr_engine(np.array(image.convert("RGB")))

    if result is None or not result.txts:
        return ""
    return "\n".join(result.txts)
