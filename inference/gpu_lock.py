from __future__ import annotations

import threading

# Shared across every module that calls into onnxruntime (faces.py, clip_embed.py,
# ocr_native.py's RapidOCR path). General-purpose defense-in-depth against
# concurrent GPU access: FastAPI dispatches each plain `def` route to its own
# threadpool thread, and the ingest pipeline processes several photos in
# parallel (see SEARCHIT_INGEST_WORKERS), so without this, multiple threads
# could call into the same DirectML-backed session at once. This trades some
# throughput (an interactive search's embed_text can wait behind a bulk
# retry's detect_faces) for safety: at most one onnxruntime call touches the
# GPU at a time, process-wide.
#
# Note: the "retry all crashes the sidecar" bug this was originally written
# for turned out to have a second, more direct cause too -- see
# clip_embed._clip_execution_providers()'s docstring. DirectML crashes
# deterministically (no concurrency needed at all) creating a session for
# CLIP's quantized vision graph on at least one real machine, so CLIP no
# longer uses DirectML. GPU_LOCK stays as a safety net for the remaining
# DirectML users (faces.py, and the RapidOCR fallback path elsewhere).
GPU_LOCK = threading.Lock()
