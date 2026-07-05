import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { faceEmbeddings, imageEmbeddings, photos } from "../db/schema";
import { detectFaces, embedImage, readSceneText } from "../inference/client";
import { resolveEventWeights } from "./eventWeights";
import { resolveIdentityForEmbedding } from "./faceMatching";
import { saveFaceThumbnail } from "./faceThumbnail";
import { generateOcrSourceImage } from "./preview";

const OCR_TEMP_DIR = path.join(os.tmpdir(), "searchit-ocr-source");

// Detector confidence floor -- low-confidence detections are the ones most
// likely to be false positives (background clutter, not an actual face), so
// they're dropped here before ever getting an identity, thumbnail, or DB row.
// Needs tuning against real photos once real weights are in place, same as
// FACE_MATCH_MAX_DISTANCE.
const FACE_MIN_CONFIDENCE = Number(process.env.FACE_MIN_CONFIDENCE ?? "0.6");

/**
 * Runs face detection + identity matching, CLIP embedding, and scene-text OCR
 * against an already-generated preview image, storing results for `photoId`.
 * Deletes any existing rows first so this is safe to call repeatedly (fresh
 * ingest, a manual reprocess, or a backfill) without accumulating duplicates.
 */
export async function runInferencePipeline(
  photoId: string,
  eventId: string,
  originalPath: string,
  previewPath: string,
  faceThumbnailDir: string,
): Promise<void> {
  await db.delete(faceEmbeddings).where(eq(faceEmbeddings.photoId, photoId));
  await db.delete(imageEmbeddings).where(eq(imageEmbeddings.photoId, photoId));

  const event = await db.query.events.findFirst({
    where: (row, { eq: equals }) => equals(row.id, eventId),
  });
  const weights = event ? resolveEventWeights(event) : undefined;

  const faceResult = await detectFaces(previewPath);
  const confidentFaces = faceResult.faces.filter(
    (face) => face.confidence >= FACE_MIN_CONFIDENCE,
  );
  for (const face of confidentFaces) {
    // A single bad face shouldn't fail the whole photo -- it should still be
    // searchable by id/date/location even if face matching hiccups.
    try {
      const identityId = await resolveIdentityForEmbedding(
        face.embedding,
        weights?.faceMatchMaxDistance,
      );
      const faceId = crypto.randomUUID();
      const thumbnailPath = await saveFaceThumbnail(
        previewPath,
        face.bbox,
        faceThumbnailDir,
        faceId,
      );
      await db.insert(faceEmbeddings).values({
        id: faceId,
        photoId,
        identityId,
        thumbnailPath,
        bbox: face.bbox,
        confidence: face.confidence,
        embedding: face.embedding,
      });
    } catch (faceError) {
      console.error(
        `[pipeline] face pipeline failed for a face in photo ${photoId}:`,
        faceError,
      );
    }
  }

  // Distinctive-elements search (Phase 3): visual embedding + general scene
  // text. Neither should fail the whole photo if it hiccups.
  try {
    const { embedding } = await embedImage(previewPath);
    await db.insert(imageEmbeddings).values({ photoId, embedding });
  } catch (embedError) {
    console.error(
      `[pipeline] image embedding failed for photo ${photoId}:`,
      embedError,
    );
  }

  try {
    const ocrSourcePath = await generateOcrSourceImage(originalPath, OCR_TEMP_DIR);
    try {
      const { text } = await readSceneText(ocrSourcePath, weights?.ocrMinConfidence);
      await db
        .update(photos)
        .set({ recognizedText: text || null })
        .where(eq(photos.id, photoId));
    } finally {
      await unlink(ocrSourcePath).catch(() => {});
    }
  } catch (sceneTextError) {
    console.error(
      `[pipeline] scene text OCR failed for photo ${photoId}:`,
      sceneTextError,
    );
  }
}
