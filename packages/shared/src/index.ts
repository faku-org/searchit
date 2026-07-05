export type PhotoStatus = "pending" | "processed" | "failed";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Biases the ingest pipeline's OCR confidence floor and face-match distance
// per event: "sports" leans on bib-number OCR over face identity, "vacation"/
// "general" flip that, "custom" lets a specific event hand-tune both numbers
// (see server/src/ingest/eventWeights.ts).
export type EventCategory = "sports" | "vacation" | "general" | "custom";

export interface EventWeights {
  ocrMinConfidence: number;
  faceMatchMaxDistance: number;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  startsAt: string | null;
  category: EventCategory;
  customOcrMinConfidence: number | null;
  customFaceMatchMaxDistance: number | null;
}

export interface CreateEventRequestBody {
  name: string;
  slug?: string;
  startsAt?: string;
  category?: EventCategory;
  customOcrMinConfidence?: number;
  customFaceMatchMaxDistance?: number;
}

export interface CreateEventResponseBody extends EventSummary {
  /** Watch-dir subfolder created for this event, for the "drop photos here" prompt. */
  folderPath: string;
}

export interface UpdateEventRequestBody {
  category: EventCategory;
  customOcrMinConfidence?: number;
  customFaceMatchMaxDistance?: number;
}

export interface UpdateEventResponseBody extends EventSummary {
  /** Already-ingested photos in this event queued for reprocessing under the new weights. */
  reprocessQueued: number;
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

export interface PhotoDetail extends PhotoSummary {
  originalPath: string;
  previewPath: string;
  cameraModel: string | null;
  width: number | null;
  height: number | null;
  faces: FaceDetection[];
  recognizedText: string | null;
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
  minConfidence?: number;
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

export interface ConfigResponseBody {
  /** Absolute path the server watches for new photos to ingest. */
  watchDir: string;
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
  /** Photos with status "failed", regardless of the /failed-photos list limit. */
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

export interface RetryAllPhotosResponseBody {
  attempted: number;
  succeeded: number;
}
