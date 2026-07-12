import path from "node:path";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import type { DiagnosticsResponseBody, StatsResponseBody } from "@searchit/shared";
import { db } from "../db/client";
import { photos } from "../db/schema";
import { checkInferenceHealth, getOcrStatus, INFERENCE_URL } from "../inference/client";
import { getIngestConcurrency, getQueueStats } from "../ingest/queue";

// index.ts validates these env vars are set and creates the directories at
// startup, so by the time requests reach these routes it's safe to resolve
// again here (same convention as routes/photos.ts).
const WATCH_DIR = path.resolve(process.env.SEARCHIT_WATCH_DIR ?? "");
const PREVIEW_DIR = path.resolve(process.env.SEARCHIT_PREVIEW_DIR ?? "");
const FACE_THUMBNAIL_DIR = path.resolve(
  process.env.SEARCHIT_FACE_THUMBNAIL_DIR ?? "",
);
// Unlike the other three, DB_DIR is only meaningful for the embedded PGlite
// backend -- an external Postgres (DATABASE_URL set) has no local directory.
const DB_DIR = process.env.DATABASE_URL
  ? null
  : path.resolve(process.env.SEARCHIT_DB_DIR ?? "../data/pgdata");

export const statsRoutes = new Elysia()
  .get("/stats", async (): Promise<StatsResponseBody> => {
    const rows = await db
      .select({
        status: photos.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(photos)
      .groupBy(photos.status);

    const countByStatus = Object.fromEntries(
      rows.map((row) => [row.status, row.count]),
    );
    const queue = getQueueStats();

    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      pending: countByStatus.pending ?? 0,
      processed: countByStatus.processed ?? 0,
      failed: countByStatus.failed ?? 0,
      active: queue.active,
      queued: queue.waiting,
    };
  })
  .get("/diagnostics", async (): Promise<DiagnosticsResponseBody> => {
    const [inferenceHealthy, ocrStatus] = await Promise.all([
      checkInferenceHealth(),
      getOcrStatus(),
    ]);
    return {
      watchDir: WATCH_DIR,
      previewDir: PREVIEW_DIR,
      faceThumbnailDir: FACE_THUMBNAIL_DIR,
      dbDir: DB_DIR,
      serverPort: Number(process.env.PORT ?? 3001),
      inferenceUrl: INFERENCE_URL,
      inferenceHealthy,
      ingestConcurrency: getIngestConcurrency(),
      ocrActiveBackend: ocrStatus.ocrActiveBackend,
      ocrHardwareCapable: ocrStatus.ocrHardwareCapable,
      ocrModelLoaded: ocrStatus.ocrModelLoaded,
    };
  });
