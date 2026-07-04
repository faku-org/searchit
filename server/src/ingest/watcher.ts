import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client";
import { events, photos } from "../db/schema";
import { readExif } from "./exif";
import { enqueue } from "./queue";
import { reprocessPhoto } from "./reprocess";

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".cr2",
  ".cr3",
  ".nef",
  ".arw",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
]);

const STABLE_CHECK_INTERVAL_MS = 500;
const STABLE_CHECK_ATTEMPTS = 6;

const pendingFiles = new Set<string>();

/**
 * Watches `watchDir` for new photos and runs each through the ingest pipeline.
 * Subfolder name under `watchDir` becomes the event slug (e.g. `incoming/marathon-2026/*`).
 * Recursive fs.watch is supported on Windows and macOS, which covers the target
 * hardware for this project; it is not guaranteed on Linux.
 */
export function startWatcher(
  watchDir: string,
  previewDir: string,
  faceThumbnailDir: string,
): void {
  watch(watchDir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(watchDir, filename.toString());
    if (!SUPPORTED_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) return;
    queueFile(fullPath, watchDir, previewDir, faceThumbnailDir);
  });

  void scanExisting(watchDir, previewDir, faceThumbnailDir);
}

async function scanExisting(
  watchDir: string,
  previewDir: string,
  faceThumbnailDir: string,
) {
  const files = await walkDir(watchDir);
  for (const fullPath of files) {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) continue;
    queueFile(fullPath, watchDir, previewDir, faceThumbnailDir);
  }
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function queueFile(
  fullPath: string,
  watchDir: string,
  previewDir: string,
  faceThumbnailDir: string,
) {
  if (pendingFiles.has(fullPath)) return;
  pendingFiles.add(fullPath);

  void waitForStableFile(fullPath)
    .then((stable) => {
      if (stable) {
        // Bounded by INGEST_CONCURRENCY (queue.ts) so a large batch drop
        // doesn't flood the single inference sidecar with dozens of
        // concurrent requests.
        return enqueue(() =>
          ingestFile(fullPath, watchDir, previewDir, faceThumbnailDir),
        );
      }
    })
    .catch((error: unknown) => {
      console.error(`[ingest] failed to process ${fullPath}:`, error);
    })
    .finally(() => {
      pendingFiles.delete(fullPath);
    });
}

/** Waits for a file's size to stop changing so we don't ingest a half-written copy. */
async function waitForStableFile(filePath: string): Promise<boolean> {
  let lastSize = -1;
  for (let attempt = 0; attempt < STABLE_CHECK_ATTEMPTS; attempt++) {
    try {
      const info = await stat(filePath);
      if (info.size === lastSize && info.size > 0) return true;
      lastSize = info.size;
    } catch {
      return false;
    }
    await Bun.sleep(STABLE_CHECK_INTERVAL_MS);
  }
  return lastSize > 0;
}

async function ingestFile(
  fullPath: string,
  watchDir: string,
  previewDir: string,
  faceThumbnailDir: string,
) {
  const existing = await db.query.photos.findFirst({
    where: (photo, { eq }) => eq(photo.originalPath, fullPath),
  });
  if (existing) return;

  const relativeDir = path.dirname(path.relative(watchDir, fullPath));
  const eventSlug =
    relativeDir === "." ? "unsorted" : relativeDir.split(path.sep)[0]!;
  const event = await ensureEvent(eventSlug);

  const exif = await readExif(fullPath);

  const [photo] = await db
    .insert(photos)
    .values({
      eventId: event.id,
      originalPath: fullPath,
      filename: path.basename(fullPath),
      takenAt: exif.takenAt,
      takenAtSource: exif.takenAtSource,
      gpsLat: exif.gpsLat,
      gpsLon: exif.gpsLon,
      cameraModel: exif.cameraModel,
      width: exif.width,
      height: exif.height,
      status: "pending",
    })
    .returning();

  if (!photo) return;

  // Preview generation + inference share their pending/processed/failed
  // bookkeeping with the manual "reprocess" and "retry all failed" paths.
  await reprocessPhoto(photo.id, previewDir, faceThumbnailDir);
}

async function ensureEvent(slug: string) {
  const existing = await db.query.events.findFirst({
    where: (event, { eq }) => eq(event.slug, slug),
  });
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(events)
      .values({ name: slug, slug })
      .returning();
    if (!created) throw new Error(`Failed to create event for slug ${slug}`);
    return created;
  } catch {
    const retried = await db.query.events.findFirst({
      where: (event, { eq }) => eq(event.slug, slug),
    });
    if (retried) return retried;
    throw new Error(`Failed to create or find event for slug ${slug}`);
  }
}
