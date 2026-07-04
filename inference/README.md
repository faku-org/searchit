# SearchIt inference service

FastAPI service that does OCR, face recognition, and CLIP embeddings. Runs on
the machine with the GPU (the central server), not on the Tauri client
machines.

## Dev / mock mode (no GPU, no model weights needed)

```
cp .env.example .env
uv sync
uv run uvicorn app:app --reload --port 8000
```

With `INFERENCE_MOCK=true` (the default), `/detect-faces` and
`/read-scene-text` return deterministic fake results per filename so the
ingest pipeline can be exercised end-to-end without any model weights. The
mock face embeddings are drawn from 5 fixed "canonical people" (with small
per-photo noise), so the same mock person recurring across different
filenames actually clusters together under the real cosine-distance matching
logic in the server -- this is what makes the identity-matching pipeline
testable without GPU weights, not just the ingest plumbing.

## Real inference (on the GPU box)

1. Install the ML extra: `uv sync --extra ml`
2. (Optional) Install `flash-attn` separately (needs a CUDA toolchain to
   build): `uv pip install flash-attn==2.7.3 --no-build-isolation`. This
   reliably builds on Linux; on Windows it usually isn't worth fighting the
   MSVC/nvcc toolchain for -- `ocr.py` detects whether `flash_attn` is
   importable and falls back to eager attention automatically when it isn't,
   so it's safe to skip.
3. Download model weights: OCR uses `deepseek-ai/DeepSeek-OCR-2` from Hugging
   Face (auto-downloads on first use, ~6.8GB).
4. Set in `.env`:
   ```
   INFERENCE_MOCK=false
   SEARCHIT_DEVICE=cuda
   OCR_MODEL_PATH=deepseek-ai/DeepSeek-OCR-2  # or a local checkout path
   ```
5. `uv run uvicorn app:app --port 8000`

`ocr.py` calls DeepSeek-OCR-2's custom `model.infer(...)` method per its model
card. That API's exact return shape isn't fully consistent across the
examples in the wild, so `read_text()` defensively also reads the result file
DeepSeek-OCR-2 writes to disk. The encoder only supports two tile sizes -- 768
(144 visual tokens) or 1024 (256 visual tokens); anything else crashes with an
`UnboundLocalError` inside `deepencoderv2.py`. On images with no legible text
the model sometimes answers conversationally instead of returning empty (e.g.
"I am sorry, but the image provided is a graphic design...") -- `read_text()`
filters known refusal phrasing back to an empty string rather than storing
the model's commentary as recognized text.

## Face recognition

`faces.py` uses `insightface`'s `buffalo_l` model pack (detector + ArcFace
512-dim embeddings), which auto-downloads on first use -- no manual weight
placement needed. `ctx_id` is derived from `SEARCHIT_DEVICE` (`0` for cuda,
`-1` for cpu); there's no Apple Silicon path since inference always runs on
the GPU box, not the Mac client.

insightface runs through onnxruntime, not torch directly -- if
`onnxruntime-gpu`'s CUDA execution provider can't find matching CUDA
12.x/cuDNN 9.x runtime libraries on the box (e.g. only a newer CUDA Toolkit is
installed system-wide), it silently falls back to `CPUExecutionProvider`.
Check `ort.get_available_providers()` if you need this on GPU; CPU is fine
for typical ingest volumes.

The match-or-new-identity threshold (`FACE_MATCH_MAX_DISTANCE`, in the
server's env) is a cosine-distance cutoff and needs tuning against real
photos once weights are in place -- the 0.6 default is a starting point, not
a validated number.

Two more knobs guard against false-positive faces (boxes on background
clutter instead of an actual face): `FACE_DET_THRESH` (this service's env,
default `0.6`) raises insightface's own detector cutoff, and
`FACE_MIN_CONFIDENCE` (the server's env, default `0.6`) drops any detection
that slips through below that confidence before it's persisted. Both are
starting points -- tune them up if false positives keep showing up, or down
if real faces start getting dropped.
