import { mkdir } from "node:fs/promises";
import path from "node:path";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { checkInferenceHealth } from "./inference/client";
import { startWatcher } from "./ingest/watcher";
import { eventsRoutes } from "./routes/events";
import { facesRoutes } from "./routes/faces";
import { identitiesRoutes } from "./routes/identities";
import { locationsRoutes } from "./routes/locations";
import { photosRoutes } from "./routes/photos";
import { searchRoutes } from "./routes/search";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const WATCH_DIR_CONFIG = process.env.SEARCHIT_WATCH_DIR;
const PREVIEW_DIR_CONFIG = process.env.SEARCHIT_PREVIEW_DIR;
const FACE_THUMBNAIL_DIR_CONFIG = process.env.SEARCHIT_FACE_THUMBNAIL_DIR;

if (!WATCH_DIR_CONFIG || !PREVIEW_DIR_CONFIG || !FACE_THUMBNAIL_DIR_CONFIG) {
  throw new Error(
    "SEARCHIT_WATCH_DIR, SEARCHIT_PREVIEW_DIR, and SEARCHIT_FACE_THUMBNAIL_DIR must be set (see .env.example)",
  );
}

// Resolved to absolute paths: Bun's recursive mkdir on Windows throws EEXIST
// for a relative path (with `..` segments) that already exists, even though
// recursive mkdir is supposed to be idempotent. Absolute paths sidestep it,
// and are also unambiguous regardless of the process's cwd.
const WATCH_DIR = path.resolve(WATCH_DIR_CONFIG);
const PREVIEW_DIR = path.resolve(PREVIEW_DIR_CONFIG);
const FACE_THUMBNAIL_DIR = path.resolve(FACE_THUMBNAIL_DIR_CONFIG);

await mkdir(WATCH_DIR, { recursive: true });
await mkdir(PREVIEW_DIR, { recursive: true });
await mkdir(FACE_THUMBNAIL_DIR, { recursive: true });

const app = new Elysia()
  .use(cors())
  .get("/health", async () => ({
    ok: true,
    inference: await checkInferenceHealth(),
  }))
  .get("/config", () => ({ watchDir: WATCH_DIR }))
  .use(searchRoutes)
  .use(photosRoutes)
  .use(eventsRoutes)
  .use(identitiesRoutes)
  .use(facesRoutes)
  .use(locationsRoutes)
  .listen({ port: PORT, hostname: HOST });

console.log(`SearchIt server listening on http://${HOST}:${PORT}`);

startWatcher(WATCH_DIR, PREVIEW_DIR, FACE_THUMBNAIL_DIR);

export type App = typeof app;
