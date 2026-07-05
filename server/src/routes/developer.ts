import path from "node:path";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  DeveloperStatsResponseBody,
  FailedPhotoSummary,
  RetryAllPhotosResponseBody,
  RetryPhotoResponseBody,
} from "@searchit/shared";
import { db } from "../db/client";
import { photos } from "../db/schema";
import { checkInferenceHealth } from "../inference/client";
import { getWorkerStats, withWorkerSlot } from "../ingest/concurrency";
import { processPhotoRow } from "../ingest/reingest";

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
// retry-all processes every failed row, but in chunks rather than firing all
// of them as pending promises at once -- with thousands of failed photos that
// would park thousands of waiters in withWorkerSlot simultaneously, which is
// unnecessary memory/scheduling pressure and maximizes exposure to any
// remaining slot-accounting edge cases. Chunking keeps "retry everything"
// semantics while bounding how much is in flight (pending + parked) at once.
const RETRY_ALL_CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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

    const [processedCount, pendingCount, recentlyIndexedCount, failedCount, inferenceOk] =
      await Promise.all([
        countPhotos(eq(photos.status, "processed")),
        countPhotos(eq(photos.status, "pending")),
        countPhotos(
          and(eq(photos.status, "processed"), gte(photos.processedAt, tenMinutesAgo)),
        ),
        countPhotos(eq(photos.status, "failed")),
        checkInferenceHealth(),
      ]);

    const { active, max } = getWorkerStats();

    return {
      currentlyIndexed: processedCount,
      queue: Math.max(0, pendingCount - active),
      processing: active,
      indexedLastTenMinutes: recentlyIndexedCount,
      workers: max,
      inferenceStatus: inferenceOk ? "ready" : "down",
      inferencePort: INFERENCE_PORT,
      serverStatus: "nominal",
      serverPort: SERVER_PORT,
      failedCount,
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

      // processPhotoRow already records the outcome (processed/failed) on the
      // row itself, so a thrown error here just means "still failed" -- the
      // caller re-reads status below rather than needing the exception.
      await withWorkerSlot(() =>
        processPhotoRow({
          photoId: photo.id,
          eventId: photo.eventId,
          originalPath: photo.originalPath,
          previewPath: photo.previewPath,
          previewDir: PREVIEW_DIR,
          faceThumbnailDir: FACE_THUMBNAIL_DIR,
          exifWidth: photo.width,
          exifHeight: photo.height,
        }),
      ).catch(() => {});

      const updated = await db.query.photos.findFirst({
        where: (row, { eq: eqRow }) => eqRow(row.id, params.id),
      });

      return { id: photo.id, status: updated?.status ?? photo.status };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post("/failed-photos/retry-all", async (): Promise<RetryAllPhotosResponseBody> => {
    const rows = await db
      .select({
        id: photos.id,
        eventId: photos.eventId,
        originalPath: photos.originalPath,
        previewPath: photos.previewPath,
        width: photos.width,
        height: photos.height,
      })
      .from(photos)
      .where(eq(photos.status, "failed"));

    // Each processPhotoRow call is bounded by withWorkerSlot's shared
    // semaphore, which bottlenecks actual inference work at
    // SEARCHIT_INGEST_WORKERS same as the folder watcher does for new files.
    // But rows are still dispatched in chunks (not all at once) to cap how
    // many pending promises/parked waiters exist simultaneously when there
    // are thousands of failed photos.
    let succeeded = 0;
    for (const batch of chunk(rows, RETRY_ALL_CHUNK_SIZE)) {
      const results = await Promise.allSettled(
        batch.map((photo) =>
          withWorkerSlot(() =>
            processPhotoRow({
              photoId: photo.id,
              eventId: photo.eventId,
              originalPath: photo.originalPath,
              previewPath: photo.previewPath,
              previewDir: PREVIEW_DIR,
              faceThumbnailDir: FACE_THUMBNAIL_DIR,
              exifWidth: photo.width,
              exifHeight: photo.height,
            }),
          ),
        ),
      );
      succeeded += results.filter((result) => result.status === "fulfilled").length;
    }

    return { attempted: rows.length, succeeded };
  });
