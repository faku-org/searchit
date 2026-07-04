import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { photos } from "../db/schema";
import { generatePreview } from "./preview";
import { runInferencePipeline } from "./pipeline";
import { runExclusive } from "./queue";

/**
 * Re-runs a photo through the full pipeline: regenerates the preview first if
 * it's missing (a photo that failed before ever getting one), then re-runs
 * face/embedding/OCR inference. Shared by fresh ingest (watcher.ts), the
 * manual "reprocess" button, and "retry all failed" -- always resets status to
 * `pending` and clears any prior `errorMessage` first, so a previously-failed
 * photo isn't stuck failed forever just because reprocessing failed to run.
 *
 * Runs exclusively per photoId (see queue.ts's runExclusive) since those three
 * callers can otherwise trigger overlapping runs for the same photo, racing
 * runInferencePipeline's delete-then-insert against itself.
 */
export function reprocessPhoto(
  photoId: string,
  previewDir: string,
  faceThumbnailDir: string,
): Promise<void> {
  return runExclusive(photoId, () =>
    reprocessPhotoInternal(photoId, previewDir, faceThumbnailDir),
  );
}

async function reprocessPhotoInternal(
  photoId: string,
  previewDir: string,
  faceThumbnailDir: string,
): Promise<void> {
  const photo = await db.query.photos.findFirst({
    where: (row, { eq }) => eq(row.id, photoId),
  });
  if (!photo) throw new Error(`Photo ${photoId} not found`);

  await db
    .update(photos)
    .set({ status: "pending", errorMessage: null })
    .where(eq(photos.id, photoId));

  try {
    let previewPath = photo.previewPath;
    if (!previewPath) {
      const preview = await generatePreview(
        photo.originalPath,
        previewDir,
        photo.id,
      );
      previewPath = preview.previewPath;
      await db
        .update(photos)
        .set({
          previewPath: preview.previewPath,
          width: photo.width ?? preview.width,
          height: photo.height ?? preview.height,
        })
        .where(eq(photos.id, photoId));
    }

    await runInferencePipeline(photoId, previewPath, faceThumbnailDir);

    await db
      .update(photos)
      .set({ status: "processed" })
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
