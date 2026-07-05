import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { photos } from "../db/schema";
import { generatePreview } from "./preview";
import { runInferencePipeline } from "./pipeline";

/**
 * Runs the full post-insert ingest flow for an existing photo row: (re)generates
 * its preview if missing, runs the inference pipeline, and updates status.
 * Shared by the folder watcher (brand-new files) and the Developer tab's
 * failed-photo retry action (existing rows stuck in `failed`, which may never
 * have gotten a preview if that's the step that failed originally).
 */
export async function processPhotoRow(params: {
  photoId: string;
  eventId: string;
  originalPath: string;
  previewPath: string | null;
  previewDir: string;
  faceThumbnailDir: string;
  exifWidth: number | null;
  exifHeight: number | null;
}): Promise<void> {
  const { photoId, eventId, originalPath, previewDir, faceThumbnailDir, exifWidth, exifHeight } =
    params;

  try {
    let previewPath = params.previewPath;
    if (!previewPath) {
      const preview = await generatePreview(originalPath, previewDir, photoId);
      previewPath = preview.previewPath;
      await db
        .update(photos)
        .set({
          previewPath: preview.previewPath,
          width: exifWidth ?? preview.width,
          height: exifHeight ?? preview.height,
        })
        .where(eq(photos.id, photoId));
    }

    await runInferencePipeline(photoId, eventId, originalPath, previewPath, faceThumbnailDir);

    await db
      .update(photos)
      .set({ status: "processed", processedAt: new Date(), errorMessage: null })
      .where(eq(photos.id, photoId));
  } catch (error) {
    await db
      .update(photos)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(photos.id, photoId));
    throw error;
  }
}
