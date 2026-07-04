import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BoundingBox } from "@searchit/shared";
import sharp from "sharp";

const THUMBNAIL_PADDING_RATIO = 0.2;

/** Crops a face bbox (with padding, clamped to image bounds) out of the preview JPEG. */
export async function saveFaceThumbnail(
  previewPath: string,
  bbox: BoundingBox,
  thumbnailDir: string,
  faceId: string,
): Promise<string> {
  await mkdir(thumbnailDir, { recursive: true });
  const thumbnailPath = path.join(thumbnailDir, `${faceId}.jpg`);

  const image = sharp(previewPath);
  const metadata = await image.metadata();
  const imageWidth = metadata.width ?? bbox.x + bbox.width;
  const imageHeight = metadata.height ?? bbox.y + bbox.height;

  const padX = Math.round(bbox.width * THUMBNAIL_PADDING_RATIO);
  const padY = Math.round(bbox.height * THUMBNAIL_PADDING_RATIO);

  const left = Math.max(0, bbox.x - padX);
  const top = Math.max(0, bbox.y - padY);
  const right = Math.min(imageWidth, bbox.x + bbox.width + padX);
  const bottom = Math.min(imageHeight, bbox.y + bbox.height + padY);

  await image
    .extract({
      left,
      top,
      width: Math.max(right - left, 1),
      height: Math.max(bottom - top, 1),
    })
    .jpeg({ quality: 85 })
    .toFile(thumbnailPath);

  return thumbnailPath;
}
