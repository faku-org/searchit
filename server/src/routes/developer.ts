import path from "node:path";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  DeveloperStatsResponseBody,
  FailedPhotoSummary,
  RetryPhotoResponseBody,
} from "@searchit/shared";
import { db } from "../db/client";
import { photos } from "../db/schema";
import { checkInferenceHealth } from "../inference/client";
import { enqueue, getIngestConcurrency, getQueueStats } from "../ingest/queue";
import { reprocessPhoto } from "../ingest/reprocess";

// Recomputed from env here rather than imported from index.ts, same pattern
// as FACE_THUMBNAIL_DIR in routes/photos.ts -- index.ts already validated
// these are set at boot.
const PREVIEW_DIR = path.resolve(process.env.SEARCHIT_PREVIEW_DIR ?? "");
const FACE_THUMBNAIL_DIR = path.resolve(
  process.env.SEARCHIT_FACE_THUMBNAIL_DIR ?? "",
);
const SERVER_PORT = Number(process.env.PORT ?? 3001);
const INFERENCE_PORT = (() => {
  try {
    const port = new URL(process.env.INFERENCE_URL ?? "http://localhost:8000")
      .port;
    return port ? Number(port) : null;
  } catch {
    return null;
  }
})();

const TEN_MINUTES_MS = 10 * 60 * 1000;
const FAILED_PHOTOS_LIMIT = 50;

async function countPhotos(where: SQL | undefined): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(photos)
    .where(where);
  return row?.value ?? 0;
}

export const developerRoutes = new Elysia({ prefix: "/developer" })
  .get("/stats", async (): Promise<DeveloperStatsResponseBody> => {
    const tenMinutesAgo = new Date(Date.now() - TEN_MINUTES_MS);

    const [processedCount, recentlyIndexedCount, inferenceOk] =
      await Promise.all([
        countPhotos(eq(photos.status, "processed")),
        countPhotos(
          and(eq(photos.status, "processed"), gte(photos.processedAt, tenMinutesAgo)),
        ),
        checkInferenceHealth(),
      ]);

    const { active, waiting } = getQueueStats();

    return {
      currentlyIndexed: processedCount,
      queue: waiting,
      processing: active,
      indexedLastTenMinutes: recentlyIndexedCount,
      workers: getIngestConcurrency(),
      inferenceStatus: inferenceOk ? "ready" : "down",
      inferencePort: INFERENCE_PORT,
      serverStatus: "nominal",
      serverPort: SERVER_PORT,
    };
  })
  .get("/failed-photos", async (): Promise<FailedPhotoSummary[]> => {
    const rows = await db
      .select({
        id: photos.id,
        filename: photos.filename,
        errorMessage: photos.errorMessage,
      })
      .from(photos)
      .where(eq(photos.status, "failed"))
      .orderBy(desc(photos.createdAt))
      .limit(FAILED_PHOTOS_LIMIT);
    return rows;
  })
  .post(
    "/failed-photos/:id/retry",
    async ({ params, set }): Promise<RetryPhotoResponseBody | { error: string }> => {
      const photo = await db.query.photos.findFirst({
        where: (row, { eq: eqRow }) => eqRow(row.id, params.id),
      });

      if (!photo) {
        set.status = 404;
        return { error: "Photo not found" };
      }

      // reprocessPhoto already records the outcome (processed/failed) on the
      // row itself, so a thrown error here just means "still failed" -- the
      // caller re-reads status below rather than needing the exception.
      await enqueue(() =>
        reprocessPhoto(photo.id, PREVIEW_DIR, FACE_THUMBNAIL_DIR),
      ).catch(() => {});

      const updated = await db.query.photos.findFirst({
        where: (row, { eq: eqRow }) => eqRow(row.id, params.id),
      });

      return { id: photo.id, status: updated?.status ?? photo.status };
    },
    { params: t.Object({ id: t.String() }) },
  );
