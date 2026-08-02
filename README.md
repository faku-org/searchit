# SearchIt

Offline-first desktop photo management for race and event photographers.

SearchIt is a desktop application built with Tauri v2 that turns a photographer's raw photo dump into a searchable archive. Photos dropped into a watched folder are automatically ingested and tagged with faces, GPS coordinates, OCR scene text, and CLIP visual embeddings, then can be found by bib number, date, location, description, or by looking for a specific person across the whole archive.

The app is fully self-contained: it ships as three processes — a React client, a Bun + Elysia API server, and a Python FastAPI inference service — all bundled as sidecars that the desktop app spawns and manages on launch. End users need no Docker, Postgres, Python, or Bun installation.

## Features

- **Watched-folder ingest** — new photos in the watch directory are detected (recursively, debounced until the file is stable), organized into events by subfolder, and processed automatically.
- **Automatic tagging pipeline** — per photo, three independent stages run in parallel: face detection + identity matching, CLIP image embedding, and OCR scene-text reading. One failing stage never blocks the others, so a photo stays searchable by date, location, or custom ID even if face matching or OCR fails.
- **Search and browse** — filter by bib number, date range, location, event, or custom ID; free-text visual search and "find similar" queries rank photos by CLIP embedding cosine similarity.
- **Cross-event identity matching** — face embeddings are matched against the entire archive (pgvector cosine distance, no event scoping), so the same person is recognized across different races and events over time.
- **People grid** — browse known identities, link faces to people, and identify a person from a new photo against ranked candidates.
- **Map view** — geotagged photos on an interactive Leaflet map, with SQL bounding-box prefiltering plus exact haversine distance filtering.
- **Developer tab** — live ingest queue stats (workers, processing, pending), server and inference health, failed-photo retry, and a reprocess flow for photos that failed on first ingest.
- **Settings** — choose the watch folder (native folder picker) and toggle model-dependent capabilities (face recognition, visual search) so heavy model downloads are skipped entirely when not needed.
- **On-device inference** — real OCR, face recognition, and CLIP embeddings run locally via ONNX Runtime (CoreML on macOS, DirectML on Windows, CPU fallback everywhere) with no torch/CUDA requirement; a higher-quality DeepSeek-OCR-2 tier is available for NVIDIA CUDA machines.
- **Embedded database** — data lives in an embedded PGlite (Postgres-in-WASM) database with pgvector support; no external Postgres needed. An opt-in `DATABASE_URL` escape hatch connects to a real Postgres.
- **Localized UI** — English and Spanish locales (typed against each other, so a missing translation is a compile error), self-hosted IBM Plex typography, and a dark navy theme.
- **Auto-update** — signed updates delivered through Tauri's updater plugin, published as draft GitHub releases on tag push.

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, motion |
| API server | Bun, Elysia, Drizzle ORM, PGlite (pgvector) |
| Inference | Python, FastAPI, ONNX Runtime (insightface, CLIP, RapidOCR / Apple Vision) |
| Map | Leaflet |
| Icons / fonts | lucide-react, IBM Plex Sans / Serif (self-hosted) |

## Getting started

Prerequisites: [Bun](https://bun.sh) and [uv](https://docs.astral.sh/uv/) (for the Python inference service).

```bash
# 1. Install root + server + shared workspace dependencies
bun install

# 2. Configure the services (each needs its own .env, copied from the example)
cp server/.env.example server/.env
cp inference/.env.example inference/.env
```

`server/.env` defaults to an embedded PGlite database under `SEARCHIT_DB_DIR` and requires `SEARCHIT_WATCH_DIR`, `SEARCHIT_PREVIEW_DIR`, and `SEARCHIT_FACE_THUMBNAIL_DIR` to be set. The inference service defaults to mock mode (`INFERENCE_MOCK=true`), which returns deterministic fake detections and embeddings per filename so the whole ingest pipeline can run end-to-end without downloading any model weights.

```bash
# 3a. Frontend-only dev (Vite dev server on port 4420)
bun dev

# 3b. Full desktop app (builds and autostarts both backend sidecars)
bun run tauri dev

# Real on-device inference instead of mock mode (onnxruntime; no torch/CUDA)
cd inference
uv sync
INFERENCE_MOCK=false uv run uvicorn app:app --reload --port 8000
```

### Useful scripts

```bash
bun run build             # tsc && vite build
bun run tauri build       # produce installers (also stages both sidecars)
bun run typecheck         # tsc --noEmit for client and server
bun run lint              # oxlint
bun run server            # run the API server standalone (bun --watch)
bun run dev:all           # client + server + inference together, outside Tauri
bun run bundle:server     # stage the server + Bun runtime as a Tauri sidecar resource
bun run bundle:inference  # PyInstaller-build the inference service as a Tauri sidecar resource
bun run db:generate       # drizzle-kit generate (after a schema.ts change)
bun run db:migrate        # apply migrations
docker-compose up -d      # optional: external Postgres for the DATABASE_URL escape hatch
```

`bun run tauri dev` and `bun run tauri build` run the bundle steps automatically via `tauri.conf.json`'s `beforeDevCommand` / `beforeBuildCommand`.

## Architecture

SearchIt is a monorepo of three processes, each of which runs standalone in development and is bundled as a sidecar in the shipped desktop app:

- **Client** (`src/`) — Tauri + React 19 + Vite + Tailwind v4. The Rust side (`src-tauri/src/lib.rs`) spawns both backend sidecars on app launch, exposes native commands (reveal-in-file-manager, backend URL resolution, watch-folder selection), and keeps the main window hidden until both services respond.
- **Server** (`server/`) — Bun + Elysia API owning the Drizzle schema and the folder-watching ingest pipeline. Talks to an embedded PGlite database by default; `DATABASE_URL` switches to external Postgres.
- **Inference** (`inference/`) — Python FastAPI microservice for OCR, face recognition, and CLIP embeddings. Communicates over HTTP and runs real on-device inference on every platform.

`@searchit/shared` (`packages/shared/`) is the single source of truth for request/response types shared between client and server; the Python service keeps its own Pydantic models in sync by hand. There is no automated test suite in this repo yet; the release workflow runs smoke tests against the built sidecars instead.

## CI/CD

`.github/workflows/release.yml` runs on `v*.*.*` tag pushes and manual dispatch:

1. **Smoke test** — builds the two backend sidecars and exercises real endpoints (matrix: self-hosted `vps-faku-org` runner and `macos-14`).
2. **Release** — `tauri-action` builds installers for Windows (signed) and macOS Apple Silicon (unsigned — no Apple Developer notarization yet), signs the updater artifacts with the `TAURI_SIGNING_PRIVATE_KEY` secrets, and publishes a **draft** GitHub release with a `latest.json` auto-update manifest (the draft must be published manually before the updater sees it as latest).
