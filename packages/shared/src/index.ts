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
