import exifr from "exifr";

export interface ExifData {
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLon: number | null;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
}

export async function readExif(filePath: string): Promise<ExifData> {
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

function emptyExif(): ExifData {
  return {
    takenAt: null,
    gpsLat: null,
    gpsLon: null,
    cameraModel: null,
    width: null,
    height: null,
  };
}
