# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor,
etc.) when working with code in this repository.

## What this is

SearchIt is a desktop app (Tauri + React) for a race/event photographer: photos
land in a watched folder, get auto-tagged (faces, GPS, OCR text, visual
embeddings), and can be searched/browsed by bib number, date, location,
description, or by finding a specific person. It's three processes, each of
which can run standalone in dev, but which the shipped desktop app bundles and
autostarts as sidecars on every install (Mac + Windows) — no Docker, Postgres,
Python, or Bun install required on the end user's machine:

- **Client** (repo root, `src/`) — Tauri + React 19 + Vite + Tailwind v4. Its
  Rust side (`src-tauri/src/lib.rs`) spawns the other two as sidecar
  processes on app launch (see "Tauri specifics" below).
- **Server** (`server/`) — Bun + Elysia API, owns the Drizzle schema and the
  folder-watching ingest pipeline. Talks to an embedded PGlite database by
  default (no external Postgres needed); pointing `DATABASE_URL` at a real
  Postgres is an opt-in dev/Docker escape hatch, not the bundled path.
- **Inference** (`inference/`) — Python FastAPI microservice (OCR, face
  recognition, CLIP embeddings). Talks HTTP, not a library import. Runs real
  on-device inference on every platform via plain `onnxruntime` (Neural
  Engine/GPU via CoreML on macOS, any DX12 GPU via DirectML on Windows, CPU
  everywhere as fallback) — no torch/CUDA required for the bundled desktop
  tier. A separate, higher-quality DeepSeek-OCR-2 tier (torch+CUDA, opt-in
  `ml` extra) is still available for anyone running this by hand on an
  NVIDIA GPU box; see `inference/README.md`.

## Commands

```bash
bun install                 # installs root + server + packages/* workspaces
bun dev                     # vite dev server (port 4420, Tauri-aware)
bun run tauri dev           # launch the actual desktop window (autostarts both sidecars)
bun run build               # tsc && vite build
bun run tauri build         # produce installers (see release workflow below)
bun run typecheck           # tsc --noEmit (root) && tsc --noEmit (server)
bun run lint                # oxlint . (root config covers client + server)
bun run server              # bun --watch server/src/index.ts (standalone, not via Tauri)
bun run bundle:server       # stage the server + Bun runtime as Tauri sidecar resources
bun run bundle:inference    # PyInstaller-build the inference service as a Tauri sidecar resource
bun run db:generate         # drizzle-kit generate (from a schema.ts change)
bun run db:migrate          # apply migrations (server/src/db/migrate.ts)
docker-compose up -d        # optional: external postgres for the DATABASE_URL dev escape hatch
```

`bun run tauri dev`/`tauri build` already run `bundle:server` and
`bundle:inference` automatically (`tauri.conf.json`'s `beforeDevCommand` /
`beforeBuildCommand`) -- you don't need to invoke those two directly unless
scripting something outside Tauri. `bundle:inference` is slow (PyInstaller +
a fresh `uv sync`, ~1-2 min) so it's skipped once already staged; force a
rebuild after inference source/dependency changes with
`FORCE_REBUILD_INFERENCE=1 bun run bundle:inference`.

Inference service uses `uv`, not Bun — it's Python:

```bash
cd inference
cp .env.example .env
uv sync                                       # mock mode, no GPU/weights needed
uv run uvicorn app:app --reload --port 8000
```

`INFERENCE_MOCK=true` (the `.env.example` default) fakes deterministic
detections/embeddings per filename with no model weights, and is what a
plain dev machine should use. `INFERENCE_MOCK=false` runs real on-device
inference (onnxruntime, no torch/CUDA needed) -- see `inference/README.md`
for the execution-provider/tiered-OCR details, and the CUDA/DeepSeek-OCR-2
`ml` extra if you're touching that specific tier.

There is no automated test suite in this repo yet.

Each service needs its own `.env` (copy from the adjacent `.env.example`):
`server/.env` and `inference/.env`. The server no longer requires
`DATABASE_URL` (defaults to an embedded PGlite database under
`SEARCHIT_DB_DIR`) but still refuses to boot without `SEARCHIT_WATCH_DIR` /
`SEARCHIT_PREVIEW_DIR` / `SEARCHIT_FACE_THUMBNAIL_DIR` set.

## Architecture

### Monorepo shape

Root `package.json` workspaces are `["server", "packages/*"]`. `@searchit/shared`
(`packages/shared/src/index.ts`) is the single source of truth for every
request/response type shared between client and server — it's not built or
published, `main`/`types` point straight at the `.ts` source. Add new
API shapes there first, then implement client + server against the same type.
The `inference/` Python service is outside this workspace entirely and has its
own Pydantic models that must be kept in sync with `@searchit/shared` by hand
(no shared schema between the two languages).

### Ingest pipeline (server/src/ingest/)

`watcher.ts` recursively watches `SEARCHIT_WATCH_DIR`. A file's immediate
subfolder under the watch dir becomes its "event" slug (auto-created if new;
top-level files fall under `unsorted`). New files are debounced until their
size stops changing (`waitForStableFile`) before being ingested, so a
half-copied file is never processed. `pipeline.ts` (`runInferencePipeline`)
then does three independent things per photo — face detection + identity
matching, CLIP image embedding, OCR scene text — each wrapped so one failing
doesn't fail the others; a photo stays searchable by date/location/customId
even if face matching or OCR errors out. Status moves `pending` →
`processed`/`failed`, and `processedAt` is stamped on success (used by the
Developer tab's "indexed in the last 10 minutes" stat).

`reprocess.ts`'s `reprocessPhoto` is the shared post-insert flow (re-derive
`takenAt` if still missing, regenerate the preview if missing, run the
pipeline, update status/`processedAt`) — used by the watcher for brand-new
files, the manual "reprocess" button, the Developer tab's failed-photo retry
action, and "retry all failed". It runs exclusively per photo ID (`queue.ts`'s
`runExclusive`) so those callers can't race `runInferencePipeline`'s
delete-then-insert against each other. `queue.ts`'s `enqueue` bounds how many
photos process at once (`INGEST_CONCURRENCY`, default 3) and exposes queue
depth/active count, which is what makes the Developer tab's "Queue"/
"Processing"/"Workers" stats and the Home tab's ingest progress bar real
numbers instead of placeholders. The same `runInferencePipeline` is reused
for manual reprocess and backfill (`routes/photos.ts`), so it always deletes
any prior face/image-embedding rows first to stay idempotent.

### Identity matching (server/src/ingest/faceMatching.ts)

`resolveIdentityForEmbedding` finds the nearest face embedding across the
**entire archive** (pgvector cosine distance, no event scoping) and reuses its
identity if within `FACE_MATCH_MAX_DISTANCE`, else creates a new identity.
Because there's no event filter, the same person is recognized across
different races/events over time. `routes/identities.ts`'s `/match-face`
endpoint (admin "identify by photo" flow) reuses the same distance logic
read-only — it ranks candidate identities instead of assigning one, via
`loadIdentityDetails()` / `rankIdentitiesByFace()`, which both `GET /` and
`/match-face` share.

### Developer tab (server/src/routes/developer.ts)

Backs the client's "Developer" tab: `GET /developer/stats` (indexed/queue/
processing counts from `photos.status` and `queue.ts`'s `getQueueStats`,
inference/server health+port), `GET /developer/failed-photos` (rows with
`status = "failed"`), and `POST /developer/failed-photos/:id/retry` (calls
`reprocessPhoto` again, so a photo that never got a preview the first time
still gets one). The panel also pulls `GET /diagnostics` and
`POST /photos/reprocess-failed` from `routes/stats.ts` (shared with the Home
tab's ingest progress bar) for the config-path card and "retry all failed".
Ports are re-derived from `PORT`/`INFERENCE_URL` env vars
rather than imported from `index.ts`, matching the pattern already used for
`FACE_THUMBNAIL_DIR` in `routes/photos.ts`.

### Search (server/src/routes/search.ts)

Structured filters (event/date range/geo/customId) combine with either a
CLIP `visualQuery` embedding (ranks by cosine similarity, drops any photo with
no image embedding yet) or, by default, a plain date-descending sort. Geo
filtering does a SQL bounding-box prefilter (`lib/geo.ts`) then an exact
haversine distance filter in JS.

### Client (src/)

`App.tsx` is the single state owner — tab (`home`/`photos`/`people`/`map`/
`developer`), filters, selected photo/identity, an in-progress "similarity
query" (from a region-select "find similar"), pending new-location, etc.
Every component under `src/components/` is presentational and talks back
through callback props; all network access goes through `src/lib/api.ts`, a
thin fetch wrapper against a **runtime-configurable** API base URL persisted
in `localStorage` (`src/lib/settings.ts`). On launch, `App.tsx` overwrites it
with the bundled server sidecar's actual dynamically-chosen port (via the
`get_backend_url` Tauri command) before making any API call; the manual
override in the header input remains for the power-user case of pointing at
a different machine's server instead of the local bundled one.

The UI is a single dark navy/blue theme (no light mode) driven by the
`@theme` tokens in `src/App.css` (brand colors `#0F2854`/`#1C4D8D`/`#4988C4`/
`#BDE8F5` extended into a full scale) plus shared class fragments in
`src/lib/theme.ts` -- reuse those tokens/fragments for any new UI rather than
hardcoding colors. Icons are `lucide-react`, fonts are self-hosted IBM Plex
Serif (headings) / IBM Plex Sans (body) via `@fontsource/*`, and
`motion/react` (the `motion` package) drives the small transitions (tab
indicator, modal enter/exit, grid stagger) — all three are real dependencies
here, not aspirational.

Two optional, model-download-dependent capabilities -- face recognition
(identity matching) and visual/free-text photo search (CLIP) -- can be
turned off from Settings (`SettingsModal.tsx`), persisted in
`src-tauri`'s `AppSettings`/`settings.json` and passed to the server sidecar
as `FACE_RECOGNITION_ENABLED`/`VISUAL_SEARCH_ENABLED` env vars (read in
`server/src/ingest/pipeline.ts`, which then skips calling `/detect-faces` or
`/embed-image` entirely -- so insightface/CLIP never even get downloaded on
that machine). The client hides the People tab and the visual-search/
face-linking controls accordingly (`App.tsx`'s `faceRecognitionEnabled`/
`visualSearchEnabled` state, sourced from both the server's `/config` and
the Tauri settings response). There's no macOS-native replacement for
either: Apple's Vision framework has no public face-*recognition* embedding
API (only detection), and its `VNGenerateImageFeaturePrintRequest` has no
text encoder, so it can't power the free-text search CLIP's `embed_text()`
does. OCR is the one capability that's already fully native on macOS/Windows
with zero download (`inference/ocr_native.py`) -- see `inference/README.md`.

Photos/events/locations/identities are kept fresh by silent polling
(`POLL_INTERVAL_MS` in `App.tsx`, `PENDING_POLL_INTERVAL_MS` in
`PhotoDetailPanel.tsx`) rather than push/websockets: a `{ silent?: boolean }`
option on each refresh function skips the loading/error UI state so
background polls don't flicker the UI, while the initial load and manual
actions still show loading/error normally. Follow this convention for any new
polled resource.

i18n is a hand-rolled context in `src/lib/i18n.tsx` (no i18next) — flat
`en`/`es` dictionaries typed against each other so a missing translation key
is a compile error, a `useTranslation()` hook, and a `statusLabel()` helper
for translating the shared `PhotoStatus` enum. Locale is persisted to
`localStorage` and mirrored onto `<html lang>`.

### Tauri specifics (src-tauri/)

Native commands (e.g. reveal-in-file-manager, `get_backend_url`,
`set_watch_dir`) live in `src-tauri/src/lib.rs` and are invoked from
`src/lib/tauri.ts`. `setup()` spawns both backend services as sidecars on
launch:

- **Server sidecar**: registered as a Tauri `externalBin` ("bun-server", a
  copy of the Bun runtime staged by `scripts/fetch-bun-sidecar.mjs`), run
  against a self-contained copy of `server/` staged by
  `scripts/bundle-server.mjs` and shipped as a Tauri *resource* (not compiled
  into the sidecar binary itself — `sharp`'s native addon and PGlite's
  pgvector extension both resolve real filesystem paths at runtime that don't
  survive `bun build --compile`'s single-file embedding).
- **Inference sidecar**: PyInstaller-built by `scripts/bundle-inference.mjs`
  into a onedir bundle, also shipped as a resource (not `externalBin` — a
  PyInstaller onedir output is a whole folder, not the single portable
  executable that convention expects) and spawned by its exact path via
  `app.shell().command(...)`.

Both bind to OS-assigned free ports; the server's is exposed to the frontend
via the `get_backend_url` command (`src/App.tsx` resolves it before any API
call, since the hardcoded `localhost:3001` default in `src/lib/settings.ts` is
only a fallback for plain-browser dev). The main window starts hidden
(`"visible": false"` in `tauri.conf.json`) until both sidecars' ports respond
or a timeout elapses, and both are killed on `RunEvent::Exit`.
`set_watch_dir` (paired with a native folder picker via `tauri-plugin-dialog`)
restarts just the server sidecar against a new watch folder, since the server
has no API to change it at runtime.

Auto-update uses `tauri-plugin-updater`: the signing keypair lives outside git
(`src-tauri/.updater.key`, gitignored — the private key + password are
GitHub Actions secrets, not committed), the public key + update endpoint are
in `tauri.conf.json`, the check/install flow is `src/lib/updater.ts`, and
`.github/workflows/release.yml` builds/signs/publishes a **draft** GitHub
release with a `latest.json` manifest on any `v*.*.*` tag push (the draft
must be published manually before the updater endpoint will see it as
"latest"). The release matrix covers Windows (signed) and macOS Apple Silicon
(unsigned — no Apple Developer account/notarization yet). Since it carries no
signature at all, Gatekeeper on current macOS refuses it outright as
"damaged" rather than offering the old right-click > Open override; users
must manually clear the quarantine flag from Terminal instead:
`xattr -cr /Applications/SearchIt.app`.

### Database

Embedded **PGlite** (Postgres-in-WASM) by default — `server/src/db/client.ts`
picks this backend whenever `DATABASE_URL` is unset, storing data under
`SEARCHIT_DB_DIR`, with pgvector support via the separate
`@electric-sql/pglite-pgvector` package (the extension moved out of PGlite's
core package in more recent versions). Setting `DATABASE_URL` switches to a
real external Postgres instead (`drizzle-orm/postgres-js`) — the
`docker-compose.yml` dev loop from before this database was embedded. Either
way it's Drizzle ORM (`server/src/db/schema.ts`), migrations in
`server/drizzle/`, applied automatically on server boot
(`runMigrations()` in `client.ts`) as well as via `bun run db:migrate`.
`identities`/`faceEmbeddings`/`imageEmbeddings` exist from the first
migration even though they were added for a later phase, so later phases
wouldn't need destructive schema changes. Embedding columns are `vector(512)`
(ArcFace for faces, CLIP for images) — both inference paths happen to share
the dimension, but they are not comparable to each other.
