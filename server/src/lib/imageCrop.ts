import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BoundingBox } from "@searchit/shared";
import sharp from "sharp";

/** Crops exactly the given bbox (clamped to bounds, no padding) into a fresh temp file. */
export async function cropToTempFile(
  sourcePath: string,
  bbox: BoundingBox,
  tempDir: string,
): Promise<string> {
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${crypto.randomUUID()}.jpg`);

  const image = sharp(sourcePath);
  const metadata = await image.metadata();
  const imageWidth = metadata.width ?? bbox.x + bbox.width;
  const imageHeight = metadata.height ?? bbox.y + bbox.height;

  const left = Math.max(0, Math.min(bbox.x, imageWidth - 1));
  const top = Math.max(0, Math.min(bbox.y, imageHeight - 1));
  const width = Math.max(1, Math.min(bbox.width, imageWidth - left));
  const height = Math.max(1, Math.min(bbox.height, imageHeight - top));

  await image
    .extract({ left, top, width, height })
    .jpeg({ quality: 90 })
    .toFile(tempPath);

  return tempPath;
}
