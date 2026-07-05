import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RAW_EXTENSIONS = new Set([
  ".cr2",
  ".cr3",
  ".nef",
  ".arw",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
]);

const PREVIEW_MAX_DIMENSION = 2048;
// OCR needs far more pixels per character than the face/CLIP pipeline or the
// on-screen preview do -- a bib number that's a small, wrinkled, motion-blurred
// tag in the original photo becomes unreadable once downscaled to the shared
// 2048px display preview. Capped higher (not uncapped) so an unusually huge
// source file doesn't blow up OCR latency/memory for no further benefit.
const OCR_SOURCE_MAX_DIMENSION = 4096;

export function isRawFile(filePath: string): boolean {
  return RAW_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export interface PreviewResult {
  previewPath: string;
  /** Decoded pixel dimensions (post EXIF-orientation), for when the source has no size EXIF tags. */
  width: number | null;
  height: number | null;
}

/**
 * Generates a JPEG working copy for display + inference. The original file at
 * `sourcePath` is only ever read, never modified.
 */
export async function generatePreview(
  sourcePath: string,
  previewDir: string,
  photoId: string,
): Promise<PreviewResult> {
  await mkdir(previewDir, { recursive: true });
  const previewPath = path.join(previewDir, `${photoId}.jpg`);

  const sourceBuffer = isRawFile(sourcePath)
    ? await extractRawPreview(sourcePath)
    : Buffer.from(await Bun.file(sourcePath).arrayBuffer());

  const image = sharp(sourceBuffer);
  const metadata = await image.metadata();
  // EXIF orientation 5-8 mean the image is rotated 90/270 degrees, so the
  // as-displayed width/height are swapped relative to the raw pixel grid.
  const isSideways = (metadata.orientation ?? 1) >= 5;
  const width = (isSideways ? metadata.height : metadata.width) ?? null;
  const height = (isSideways ? metadata.width : metadata.height) ?? null;

  await image
    .rotate()
    .resize({
      width: PREVIEW_MAX_DIMENSION,
      height: PREVIEW_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toFile(previewPath);

  return { previewPath, width, height };
}

/**
 * Same source handling as generatePreview (RAW extraction, EXIF rotation) but
 * capped much higher and written to a fresh temp file for the caller to
 * delete -- a dedicated working copy for OCR only, since the display preview
 * that's plenty for the photo grid/detail panel is often too small to
 * resolve a bib number shot from a few meters away.
 */
export async function generateOcrSourceImage(
  sourcePath: string,
  tempDir: string,
): Promise<string> {
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${crypto.randomUUID()}.jpg`);

  const sourceBuffer = isRawFile(sourcePath)
    ? await extractRawPreview(sourcePath)
    : Buffer.from(await Bun.file(sourcePath).arrayBuffer());

  await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: OCR_SOURCE_MAX_DIMENSION,
      height: OCR_SOURCE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 95 })
    .toFile(tempPath);

  return tempPath;
}

/**
 * RAW files aren't decoded here; exiftool pulls the embedded full-res JPEG
 * preview instead. Different manufacturers embed it under different tags, so
 * both are tried. Requires `exiftool` on PATH of the machine running the server.
 */
async function extractRawPreview(sourcePath: string): Promise<Buffer> {
  for (const tag of ["-JpgFromRaw", "-PreviewImage"]) {
    try {
      const buffer = await runExiftoolExtract(sourcePath, tag);
      if (buffer.length > 0) return buffer;
    } catch {
      // try the next tag
    }
  }

  throw new Error(
    `exiftool could not extract an embedded preview from ${sourcePath}. ` +
      "Is exiftool installed and does this RAW file contain an embedded preview?",
  );
}

function runExiftoolExtract(sourcePath: string, tag: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn("exiftool", ["-b", tag, sourcePath]);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`exiftool exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}
