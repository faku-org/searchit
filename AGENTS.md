# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor,
etc.) when working with code in this repository.

## What this is

SearchIt is a desktop app (Tauri + React) for a race/event photographer: photos
land in a watched folder, get auto-tagged (faces, GPS, OCR text, visual
embeddings), and can be searched/browsed by bib number, date, location,
description, or by finding a specific person. It's three independently-run
processes plus Postgres:

- **Client** (repo root, `src/`) — Tauri + React 19 + Vite + Tailwind v4.
- **Server** (`server/`) — Bun + Elysia API, owns the Postgres/Drizzle schema
  and the folder-watching ingest pipeline.
- **Inference** (`inference/`) — Python FastAPI microservice (OCR, face
  recognition, CLIP embeddings). Talks HTTP, not a library import, so it can
  run on a separate GPU box from the API server.
- **Postgres** with the `pgvector` extension (`docker-compose.yml`).

## Commands

```bash
bun install                 # installs root + server + packages/* workspaces
bun dev                     # vite dev server (port 1420, Tauri-aware)
bun run tauri dev           # launch the actual desktop window
bun run build               # tsc && vite build
bun run tauri build         # produce installers (see release workflow below)
bun run typecheck           # tsc --noEmit (root) && tsc --noEmit (server)
bun run lint                # oxlint . (root config covers client + server)
bun run server              # bun --watch server/src/index.ts
bun run db:generate         # drizzle-kit generate (from a schema.ts change)
bun run db:migrate          # apply migrations (server/src/db/migrate.ts)
docker-compose up -d        # postgres (pgvector/pgvector:pg16), must be up first
```

Inference service uses `uv`, not Bun — it's Python:

```bash
cd inference
cp .env.example .env
uv sync                                       # mock mode, no GPU/weights needed
uv run uvicorn app:app --reload --port 8000
```

`INFERENCE_MOCK=true` (the `.env.example` default) fakes deterministic
detections/embeddings per filename with no model weights, and is what a
plain dev machine should use. Real inference needs `uv sync --extra ml` plus
GPU env vars — see `inference/README.md` for the CUDA/DeepSeek-OCR-2/
insightface specifics if you're touching that code.

There is no automated test suite in this repo yet.

Each service needs its own `.env` (copy from the adjacent `.env.example`):
`server/.env` and `inference/.env`. The server refuses to boot without
`SEARCHIT_WATCH_DIR` / `SEARCHIT_PREVIEW_DIR` / `SEARCHIT_FACE_THUMBNAIL_DIR`
set.

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
`processed`/`failed`. The same function is reused for manual reprocess and
backfill (`routes/photos.ts`), so it always deletes any prior
face/image-embedding rows first to stay idempotent.

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

### Search (server/src/routes/search.ts)

Structured filters (event/date range/geo/customId) combine with either a
CLIP `visualQuery` embedding (ranks by cosine similarity, drops any photo with
no image embedding yet) or, by default, a plain date-descending sort. Geo
filtering does a SQL bounding-box prefilter (`lib/geo.ts`) then an exact
haversine distance filter in JS.

### Client (src/)

`App.tsx` is the single state owner — tab (`photos`/`people`/`map`), filters,
selected photo/identity, an in-progress "similarity query" (from a
region-select "find similar"), pending new-location, etc. Every component
under `src/components/` is presentational and talks back through callback
props; all network access goes through `src/lib/api.ts`, a thin fetch wrapper
against a **runtime-configurable** API base URL persisted in `localStorage`
(`src/lib/settings.ts`) — the desktop client is expected to point at a
different machine's server, not always `localhost`.

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

Native commands (e.g. reveal-in-file-manager) live in `src-tauri/src/lib.rs`
and are invoked from `src/lib/tauri.ts`. Auto-update uses
`tauri-plugin-updater`: the signing keypair lives outside git
(`src-tauri/.updater.key`, gitignored — the private key + password are
GitHub Actions secrets, not committed), the public key + update endpoint are
in `tauri.conf.json`, the check/install flow is `src/lib/updater.ts`, and
`.github/workflows/release.yml` builds/signs/publishes a **draft** GitHub
release with a `latest.json` manifest on any `v*.*.*` tag push (the draft
must be published manually before the updater endpoint will see it as
"latest").

### Database

Postgres + `pgvector`, Drizzle ORM (`server/src/db/schema.ts`), migrations in
`server/drizzle/`. `identities`/`faceEmbeddings`/`imageEmbeddings` exist from
the first migration even though they were added for a later phase, so later
phases wouldn't need destructive schema changes. Embedding columns are
`vector(512)` (ArcFace for faces, CLIP for images) — both inference paths
happen to share the dimension, but they are not comparable to each other.
