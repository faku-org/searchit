export type PhotoStatus = "pending" | "processed" | "failed";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  startsAt: string | null;
  photoCount: number;
}

export interface CreateEventRequestBody {
  name: string;
  slug?: string;
  startsAt?: string;
}

export interface LocationSummary {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface CreateLocationRequestBody {
  name: string;
  lat: number;
  lon: number;
}

export interface PhotoSummary {
  id: string;
  eventId: string;
  filename: string;
  takenAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  status: PhotoStatus;
  customId: string | null;
}

export interface FaceDetection {
  id: string;
  identityId: string | null;
  thumbnailUrl: string;
  confidence: number;
  bbox: BoundingBox;
}

export type TakenAtSource = "exif" | "filesystem";

export interface PhotoDetail extends PhotoSummary {
  originalPath: string;
  previewPath: string;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
  faces: FaceDetection[];
  recognizedText: string | null;
  errorMessage: string | null;
  takenAtSource: TakenAtSource | null;
  hasImageEmbedding: boolean;
}

export interface UpdatePhotoRequestBody {
  customId: string | null;
}

export interface IdentitySummary {
  id: string;
  displayName: string | null;
  photoCount: number;
  thumbnailUrl: string | null;
}

export interface SearchFilters {
  eventId?: string;
  customId?: string;
  from?: string;
  to?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  locationId?: string;
  visualQuery?: string;
  sceneText?: string;
  /** Smart combined search: matches bib/ID, OCR text, filename, and (if none of those match) visual similarity. */
  q?: string;
}

export interface DetectFacesRequestBody {
  imagePath: string;
}

export interface DetectFacesResult {
  confidence: number;
  bbox: BoundingBox;
  embedding: number[];
}

export interface DetectFacesResponseBody {
  faces: DetectFacesResult[];
}

export interface EmbedImageRequestBody {
  imagePath: string;
}

export interface EmbedImageResponseBody {
  embedding: number[];
}

export interface EmbedTextRequestBody {
  text: string;
}

export interface EmbedTextResponseBody {
  embedding: number[];
}

export interface ReadSceneTextRequestBody {
  imagePath: string;
}

export interface ReadSceneTextResponseBody {
  text: string;
}

export type SelectRegionAction = "face" | "similar";

export interface SelectRegionRequestBody {
  bbox: BoundingBox;
  action: SelectRegionAction;
}

export type SelectRegionResponseBody =
  | { action: "face"; identityId: string }
  | { action: "similar"; results: PhotoSummary[] };

export interface BackfillResponseBody {
  queued: number;
}

export interface ReprocessFailedResponseBody {
  queued: number;
}

export interface ConfigResponseBody {
  /** Absolute path the server watches for new photos to ingest. */
  watchDir: string;
  /** Whether identity matching runs at all (see server/src/ingest/pipeline.ts). */
  faceRecognitionEnabled: boolean;
  /** Whether visual/text photo search runs at all (see server/src/ingest/pipeline.ts). */
  visualSearchEnabled: boolean;
}

export interface StatsResponseBody {
  total: number;
  pending: number;
  processed: number;
  failed: number;
  /** Currently running through the inference pipeline (bounded by ingest concurrency). */
  active: number;
  /** Waiting for a free worker slot. */
  queued: number;
}

export interface DiagnosticsResponseBody {
  watchDir: string;
  previewDir: string;
  faceThumbnailDir: string;
  dbDir: string | null;
  serverPort: number;
  inferenceUrl: string;
  inferenceHealthy: boolean;
  ingestConcurrency: number;
}

export interface FaceMatchCandidate {
  identityId: string;
  displayName: string | null;
  /** Cosine distance to the uploaded face (0 = identical, lower is a closer match). */
  distance: number;
  thumbnailUrl: string | null;
  photoCount: number;
}

export interface MatchFaceResponseBody {
  candidates: FaceMatchCandidate[];
}

export interface DeveloperStatsResponseBody {
  /** Photos with status "processed". */
  currentlyIndexed: number;
  /** Pending photos not currently occupying a worker slot. */
  queue: number;
  /** Pending photos currently being processed (bounded by `workers`). */
  processing: number;
  /** Photos that finished processing in the last 10 minutes. */
  indexedLastTenMinutes: number;
  /** Max photos the ingest pipeline processes concurrently. */
  workers: number;
  inferenceStatus: "ready" | "down";
  inferencePort: number | null;
  serverStatus: "nominal";
  serverPort: number;
  /** Photos with status "failed". */
  failedCount: number;
}

export interface FailedPhotoSummary {
  id: string;
  filename: string;
  errorMessage: string | null;
}

export interface RetryPhotoResponseBody {
  id: string;
  status: PhotoStatus;
}
