# SearchIt inference service

FastAPI service that does OCR, face recognition, and CLIP embeddings. Runs
locally on each desktop client (bundled as a Tauri sidecar), using real
on-device inference -- Neural Engine/GPU via CoreML on macOS, any DX12 GPU via
DirectML on Windows, CPU everywhere as a guaranteed fallback. A separate,
higher-quality OCR tier (DeepSeek-OCR-2) is still available for anyone running
this service by hand on an NVIDIA CUDA box.

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

## Real inference, on-device (the desktop client default)

With `INFERENCE_MOCK=false` and no `OCR_MODEL_PATH` configured, every endpoint
runs a real model, entirely on onnxruntime -- no torch, no CUDA required.
`onnxruntime` (the plain CPU-only wheel) is a base dependency via
`insightface`, so a bare `uv sync` already gets you real inference on CPU,
CoreML on macOS included (that wheel bundles CoreML for free). Windows GPU
(DirectML, any DX12 GPU) is opt-in:

```
uv sync --extra directml
uv pip install --reinstall --no-deps onnxruntime-directml
```

The second line matters: `insightface` hard-depends on plain `onnxruntime`
regardless of extras, and it shares its import path with
`onnxruntime-directml`, so `uv sync --extra directml` alone ends up with
*both* wheels installed side by side -- whichever wins the shared
`onnxruntime/` directory on disk decides what actually runs, silently, with
no error. Force-reinstalling DirectML last makes it win. Confirm via
`GET /health`'s `providers` field rather than assuming.
`scripts/bundle-inference.mjs` does this automatically for Windows sidecar
builds; it's only a manual step for a Windows dev box running `inference/`
directly.

- **Faces** (`faces.py`): `insightface`'s `buffalo_l` pack (detector + ArcFace
  512-dim embeddings), auto-downloaded into `MODEL_CACHE_DIR` on first use.
- **CLIP** (`clip_embed.py`): a pre-exported ONNX build of
  `openai/clip-vit-base-patch32` (`Xenova/clip-vit-base-patch32`'s quantized
  vision/text encoders, ~150MB combined), also downloaded on first use.
- **OCR** (`ocr_native.py`): Apple Vision (OS-native, no model download) on
  macOS; a small bundled ONNX OCR model (RapidOCR, ~32MB weights shipped in
  the pip package) everywhere else, including Windows. Windows used to
  default to `Windows.Media.Ocr` instead, but it missed small/angled bib
  numbers on race photos that RapidOCR reads correctly, so it was dropped.
  `scripts/bundle-inference.mjs` `--collect-data`s RapidOCR's weights the
  same way it does insightface's, so the shipped sidecar works offline from
  first launch instead of downloading them at runtime. Like faces.py and
  clip_embed.py, it runs on `config.get_execution_providers()`'s pick
  (DirectML on Windows, CUDA on the `ml` extra's box) instead of RapidOCR's
  own CPU-only defaults -- same DirectML force-reinstall caveat above applies.

Two capabilities beyond OCR can be turned off entirely from the desktop
client's Settings (face recognition, visual/text search) -- see
`FACE_RECOGNITION_ENABLED`/`VISUAL_SEARCH_ENABLED` in
`server/src/ingest/pipeline.ts`. When off, this service's `/detect-faces` or
`/embed-image` endpoint is simply never called, so insightface/CLIP never
download or load on that machine. There's no macOS-native swap for either:
Apple's Vision framework has no public face-*recognition* embedding API
(only detection), and its `VNGenerateImageFeaturePrintRequest` has no text
encoder, so it can't replace CLIP's `embed_text()` (the free-text photo
search feature).

`config.get_execution_providers()` picks the best available onnxruntime
execution provider at runtime (`ort.get_available_providers()`), in this
order: CUDA (if the `ml` extra's `onnxruntime-gpu` is installed and a CUDA GPU
is present) > the platform's native accelerator (CoreML on macOS,
`DmlExecutionProvider` on Windows) > CPU.

The Apple Vision path in `ocr_native.py` is written against Apple's documented
Vision APIs but hasn't been run on an actual Mac yet -- re-verify it there
before relying on it.

## Real inference, DeepSeek-OCR-2 tier (NVIDIA CUDA or Apple Silicon MPS)

`config.resolve_ocr_backend()` decides whether `/read-scene-text` uses this
tier, based on `OCR_TIER` (env var, default `auto`):

- `auto` (default): uses DeepSeek-OCR-2 only when `OCR_MODEL_PATH` is set
  *and* the detected hardware looks comfortably capable of running it --
  `hardware.py`'s `cuda_capable()` (an NVIDIA GPU with >=8GB VRAM, via
  `nvidia-smi`) or `mps_capable()` (an Apple Silicon Mac with >=16GB unified
  memory, via `sysctl hw.memsize`). Otherwise falls back to `ocr_native.py`,
  same as before this setting existed -- **auto never triggers the ~6.8GB
  weight download by itself**; that only happens once `OCR_MODEL_PATH` is
  configured (step 3 below), which is meant to be an explicit, opted-into
  step (a client-side "enable high-quality OCR?" flow), not something that
  happens just because a box has a good GPU.
- `native`: always use the OS-native/ONNX tier regardless of hardware.
- `deepseek`: force this tier if `OCR_MODEL_PATH` is set, preferring CUDA
  over MPS over falling back to native (never CPU -- a multi-GB transformer
  on CPU is too slow to be worth it), even if the detected VRAM/memory looks
  thin. Logs a warning and falls back to native if forced but genuinely
  impossible (no weights configured, or no CUDA/MPS device at all).

This tier is torch-only (CUDA or MPS) and multi-GB, so it's still opt-in and
never used on a plain desktop client that hasn't configured `OCR_MODEL_PATH`:

1. Install the ML extra: `uv sync --extra ml`
2. (Optional, CUDA only) Install `flash-attn` separately (needs a CUDA
   toolchain to build): `uv pip install flash-attn==2.7.3 --no-build-isolation`.
   This reliably builds on Linux; on Windows it usually isn't worth fighting
   the MSVC/nvcc toolchain for -- `ocr.py` detects whether `flash_attn` is
   importable and falls back to eager attention automatically when it isn't,
   so it's safe to skip. There's no MPS build of flash-attn at all -- Mac
   always uses eager attention.
3. Download model weights: OCR uses `deepseek-ai/DeepSeek-OCR-2` from Hugging
   Face (auto-downloads on first use, ~6.8GB).
4. Set in `.env`:
   ```
   INFERENCE_MOCK=false
   OCR_MODEL_PATH=deepseek-ai/DeepSeek-OCR-2  # or a local checkout path
   # OCR_TIER=auto is the default and usually right -- set OCR_TIER=deepseek
   # to force it, or OCR_TIER=native to force the OS-native tier instead.
   ```
5. `uv run uvicorn app:app --port 8000`

The Mac/MPS path (`_load_model()` in `ocr.py`) is written against documented
PyTorch MPS APIs but hasn't been run on real Apple Silicon hardware yet --
same caveat as the Apple Vision path in `ocr_native.py`. If `model.to(torch.bfloat16)`
errors out on a real Mac (MPS bf16 op coverage has historically lagged CUDA's),
try `torch.float16` instead for that device.

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
512-dim embeddings), which auto-downloads on first use into `MODEL_CACHE_DIR`
-- no manual weight placement needed. `providers` comes from
`config.get_execution_providers()` (see above); `ctx_id` is derived from
whether that resolved to CPU-only or not, since some of insightface's
non-onnxruntime post-processing branches on it.

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
