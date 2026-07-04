import { stat } from "node:fs/promises";
import exifr from "exifr";
import type { TakenAtSource } from "@searchit/shared";

export interface ExifData {
  takenAt: Date | null;
  takenAtSource: TakenAtSource | null;
  gpsLat: number | null;
  gpsLon: number | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
}

export async function readExif(filePath: string): Promise<ExifData> {
  const exif = await parseExifDate(filePath);
  const fallback = exif.takenAt ? null : await readFilesystemDate(filePath);

  return {
    takenAt: exif.takenAt ?? fallback,
    takenAtSource: exif.takenAt ? "exif" : fallback ? "filesystem" : null,
    gpsLat: exif.gpsLat,
    gpsLon: exif.gpsLon,
    cameraModel: exif.cameraModel,
    width: exif.width,
    height: exif.height,
  };
}

async function parseExifDate(filePath: string): Promise<{
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLon: number | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
}> {
  try {
    const data = await exifr.parse(filePath, { gps: true });
    if (!data) return emptyExif();

    const takenAt =
      data.DateTimeOriginal instanceof Date
        ? data.DateTimeOriginal
        : data.CreateDate instanceof Date
          ? data.CreateDate
          : null;

    const cameraModel =
      data.Make && data.Model
        ? `${data.Make} ${data.Model}`.trim()
        : (data.Model ?? data.Make ?? null);

    return {
      takenAt,
      gpsLat: typeof data.latitude === "number" ? data.latitude : null,
      gpsLon: typeof data.longitude === "number" ? data.longitude : null,
      cameraModel,
      width: data.ExifImageWidth ?? data.ImageWidth ?? null,
      height: data.ExifImageHeight ?? data.ImageHeight ?? null,
    };
  } catch (error) {
    console.warn(`[exif] failed to read ${filePath}:`, error);
    return emptyExif();
  }
}

/**
 * Falls back to what the OS file properties dialog shows when a photo has no
 * EXIF date at all (common for edited/exported JPEGs): creation time where the
 * filesystem actually tracks one, otherwise last-modified time.
 */
async function readFilesystemDate(filePath: string): Promise<Date | null> {
  try {
    const info = await stat(filePath);
    // On filesystems that don't track real creation time (e.g. most Linux
    // setups), birthtime is reported equal to mtime or as the epoch -- either
    // way falling through to mtime is still a real, meaningful date.
    if (info.birthtime instanceof Date && info.birthtimeMs > 0) {
      return info.birthtime;
    }
    return info.mtime instanceof Date ? info.mtime : null;
  } catch (error) {
    console.warn(`[exif] failed to stat ${filePath}:`, error);
    return null;
  }
}

function emptyExif(): {
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLon: number | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
} {
  return {
    takenAt: null,
    gpsLat: null,
    gpsLon: null,
    cameraModel: null,
    width: null,
    height: null,
  };
}
