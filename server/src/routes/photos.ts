import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, isNull, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  BackfillResponseBody,
  PhotoDetail,
  PhotoSummary,
  SelectRegionResponseBody,
} from "@searchit/shared";
import { db } from "../db/client";
import { faceEmbeddings, imageEmbeddings, photos } from "../db/schema";
import { resolveIdentityForEmbedding } from "../ingest/faceMatching";
import { saveFaceThumbnail } from "../ingest/faceThumbnail";
import { runInferencePipeline } from "../ingest/pipeline";
import { detectFaces, embedImage } from "../inference/client";
import { cropToTempFile } from "../lib/imageCrop";
import { cosineSimilarity } from "../lib/vector";

// index.ts validates this env var is set and creates the directory at startup,
// so by the time requests reach these routes it's safe to resolve again here.
const FACE_THUMBNAIL_DIR = path.resolve(
  process.env.SEARCHIT_FACE_THUMBNAIL_DIR ?? "",
);
const TEMP_CROP_DIR = path.join(os.tmpdir(), "searchit-crops");
const SIMILARITY_RESULT_LIMIT = 100;

async function rankBySimilarity(
  referenceEmbedding: number[],
  excludePhotoId: string,
  limit: number,
): Promise<PhotoSummary[]> {
  const rows = await db
    .select({
      id: photos.id,
      eventId: photos.eventId,
      filename: photos.filename,
      takenAt: photos.takenAt,
      gpsLat: photos.gpsLat,
      gpsLon: photos.gpsLon,
      status: photos.status,
      customId: photos.customId,
      embedding: imageEmbeddings.embedding,
    })
    .from(photos)
    .innerJoin(imageEmbeddings, eq(imageEmbeddings.photoId, photos.id))
    .where(ne(photos.id, excludePhotoId));

  return rows
    .filter(
      (row): row is typeof row & { embedding: number[] } =>
        row.embedding !== null,
    )
    .sort(
      (a, b) =>
        cosineSimilarity(b.embedding, referenceEmbedding) -
        cosineSimilarity(a.embedding, referenceEmbedding),
    )
    .slice(0, limit)
    .map(
      (row): PhotoSummary => ({
        id: row.id,
        eventId: row.eventId,
        filename: row.filename,
        takenAt: row.takenAt ? row.takenAt.toISOString() : null,
        gpsLat: row.gpsLat,
        gpsLon: row.gpsLon,
        status: row.status,
        customId: row.customId,
      }),
    );
}

async function loadPhotoDetail(id: string): Promise<PhotoDetail | null> {
  const photo = await db.query.photos.findFirst({
    where: (row, { eq }) => eq(row.id, id),
    with: { faceEmbeddings: true },
  });

  if (!photo) return null;

  return {
    id: photo.id,
    eventId: photo.eventId,
    filename: photo.filename,
    takenAt: photo.takenAt ? photo.takenAt.toISOString() : null,
    gpsLat: photo.gpsLat,
    gpsLon: photo.gpsLon,
    status: photo.status,
    customId: photo.customId,
    originalPath: photo.originalPath,
    previewPath: photo.previewPath ?? "",
    cameraModel: photo.cameraModel,
    width: photo.width,
    height: photo.height,
    faces: photo.faceEmbeddings.map((face) => ({
      id: face.id,
      identityId: face.identityId,
      thumbnailUrl: `/faces/${face.id}/thumbnail`,
      confidence: face.confidence,
      bbox: face.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
    })),
    recognizedText: photo.recognizedText,
  };
}

export const photosRoutes = new Elysia({ prefix: "/photos" })
  .get(
    "/:id",
    async ({ params, set }) => {
      const detail = await loadPhotoDetail(params.id);
      if (!detail) {
        set.status = 404;
        return { error: "Photo not found" };
      }
      return detail;
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const [updated] = await db
        .update(photos)
        .set({ customId: body.customId })
        .where(eq(photos.id, params.id))
        .returning();

      if (!updated) {
        set.status = 404;
        return { error: "Photo not found" };
      }

      return await loadPhotoDetail(params.id);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ customId: t.Nullable(t.String()) }),
    },
  )
  .get(
    "/:id/preview",
    async ({ params, set }) => {
      const photo = await db.query.photos.findFirst({
        where: (row, { eq }) => eq(row.id, params.id),
      });

      if (!photo?.previewPath) {
        set.status = 404;
        return { error: "Preview not available" };
      }

      return Bun.file(photo.previewPath);
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/:id/reprocess",
    async ({ params, set }) => {
      const photo = await db.query.photos.findFirst({
        where: (row, { eq }) => eq(row.id, params.id),
      });

      if (!photo) {
        set.status = 404;
        return { error: "Photo not found" };
      }
      if (!photo.previewPath) {
        set.status = 400;
        return { error: "Photo has no preview yet, it may still be processing" };
      }

      await runInferencePipeline(photo.id, photo.previewPath, FACE_THUMBNAIL_DIR);
      await db
        .update(photos)
        .set({ processedAt: new Date() })
        .where(eq(photos.id, photo.id));
      return await loadPhotoDetail(photo.id);
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/:id/select-region",
    async ({ params, body, set }) => {
      const photo = await db.query.photos.findFirst({
        where: (row, { eq }) => eq(row.id, params.id),
      });

      if (!photo) {
        set.status = 404;
        return { error: "Photo not found" };
      }
      if (!photo.previewPath) {
        set.status = 400;
        return {
          error: "Photo has no preview yet, it may still be processing",
        };
      }

      const tempCropPath = await cropToTempFile(
        photo.previewPath,
        body.bbox,
        TEMP_CROP_DIR,
      );

      try {
        if (body.action === "face") {
          const { faces } = await detectFaces(tempCropPath);
          const [detected] = faces;
          if (!detected) {
            set.status = 422;
            return { error: "No face detected in that selection" };
          }

          const identityId = await resolveIdentityForEmbedding(
            detected.embedding,
          );
          const faceId = crypto.randomUUID();
          const thumbnailPath = await saveFaceThumbnail(
            photo.previewPath,
            body.bbox,
            FACE_THUMBNAIL_DIR,
            faceId,
          );
          await db.insert(faceEmbeddings).values({
            id: faceId,
            photoId: photo.id,
            identityId,
            thumbnailPath,
            bbox: body.bbox,
            confidence: detected.confidence,
            embedding: detected.embedding,
          });

          const response: SelectRegionResponseBody = {
            action: "face",
            identityId,
          };
          return response;
        }

        const { embedding } = await embedImage(tempCropPath);
        const results = await rankBySimilarity(
          embedding,
          photo.id,
          SIMILARITY_RESULT_LIMIT,
        );

        const response: SelectRegionResponseBody = {
          action: "similar",
          results,
        };
        return response;
      } finally {
        await unlink(tempCropPath).catch(() => {});
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        bbox: t.Object({
          x: t.Number(),
          y: t.Number(),
          width: t.Number(),
          height: t.Number(),
        }),
        action: t.Union([t.Literal("face"), t.Literal("similar")]),
      }),
    },
  )
  .post("/backfill", async (): Promise<BackfillResponseBody> => {
    // Absence of an image_embeddings row reliably means "never touched by the
    // current full pipeline" (that table is always populated 1:1 once a photo
    // goes through it), which is exactly the class of photo ingested before a
    // later phase (faces, CLIP) existed.
    const candidates = await db
      .select({ id: photos.id, previewPath: photos.previewPath })
      .from(photos)
      .leftJoin(imageEmbeddings, eq(imageEmbeddings.photoId, photos.id))
      .where(and(eq(photos.status, "processed"), isNull(imageEmbeddings.id)));

    const reprocessable = candidates.filter(
      (candidate): candidate is { id: string; previewPath: string } =>
        candidate.previewPath !== null,
    );

    void (async () => {
      for (const candidate of reprocessable) {
        try {
          await runInferencePipeline(
            candidate.id,
            candidate.previewPath,
            FACE_THUMBNAIL_DIR,
          );
        } catch (error) {
          console.error(`[backfill] failed for photo ${candidate.id}:`, error);
        }
      }
    })();

    return { queued: reprocessable.length };
  });
