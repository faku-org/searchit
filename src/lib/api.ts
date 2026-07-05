import type {
  BackfillResponseBody,
  BoundingBox,
  ConfigResponseBody,
  CreateEventRequestBody,
  CreateEventResponseBody,
  CreateLocationRequestBody,
  DeveloperStatsResponseBody,
  EventSummary,
  FailedPhotoSummary,
  IdentitySummary,
  LocationSummary,
  MatchFaceResponseBody,
  PhotoDetail,
  PhotoSummary,
  RetryAllPhotosResponseBody,
  RetryPhotoResponseBody,
  SearchFilters,
  SelectRegionAction,
  SelectRegionResponseBody,
} from "@searchit/shared";
import { getApiBaseUrl } from "./settings";

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request to ${path} failed: ${response.status}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function apiJsonRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Resolves a server-relative URL (e.g. a thumbnailUrl from the API) against the configured API base. */
export function resolveApiUrl(relativeUrl: string): string {
  return `${getApiBaseUrl()}${relativeUrl}`;
}

export function getConfig(): Promise<ConfigResponseBody> {
  return apiFetch<ConfigResponseBody>("/config");
}

export function searchPhotos(filters: SearchFilters): Promise<PhotoSummary[]> {
  const params = new URLSearchParams();
  if (filters.eventId) params.set("eventId", filters.eventId);
  if (filters.customId) params.set("customId", filters.customId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.lat !== undefined) params.set("lat", String(filters.lat));
  if (filters.lon !== undefined) params.set("lon", String(filters.lon));
  if (filters.radiusKm !== undefined) {
    params.set("radiusKm", String(filters.radiusKm));
  }
  if (filters.locationId) params.set("locationId", filters.locationId);
  if (filters.visualQuery) params.set("visualQuery", filters.visualQuery);
  if (filters.sceneText) params.set("sceneText", filters.sceneText);

  return apiFetch<PhotoSummary[]>(`/search?${params.toString()}`);
}

export function getEvents(): Promise<EventSummary[]> {
  return apiFetch<EventSummary[]>("/events");
}

export function createEvent(
  body: CreateEventRequestBody,
): Promise<CreateEventResponseBody> {
  return apiJsonRequest("POST", "/events", body);
}

export function getLocations(): Promise<LocationSummary[]> {
  return apiFetch<LocationSummary[]>("/locations");
}

export function createLocation(
  body: CreateLocationRequestBody,
): Promise<LocationSummary> {
  return apiJsonRequest("POST", "/locations", body);
}

export function setPhotoCustomId(
  id: string,
  customId: string | null,
): Promise<PhotoDetail> {
  return apiJsonRequest("PATCH", `/photos/${id}`, { customId });
}

export function getPhotoDetail(id: string): Promise<PhotoDetail> {
  return apiFetch<PhotoDetail>(`/photos/${id}`);
}

export function previewUrl(id: string): string {
  return `${getApiBaseUrl()}/photos/${id}/preview`;
}

export function getIdentities(): Promise<IdentitySummary[]> {
  return apiFetch<IdentitySummary[]>("/identities");
}

export function getIdentityPhotos(id: string): Promise<PhotoSummary[]> {
  return apiFetch<PhotoSummary[]>(`/identities/${id}/photos`);
}

export function matchFace(photo: File): Promise<MatchFaceResponseBody> {
  const formData = new FormData();
  formData.append("photo", photo);
  return apiFetch<MatchFaceResponseBody>("/identities/match-face", {
    method: "POST",
    body: formData,
  });
}

export function renameIdentity(
  id: string,
  displayName: string | null,
): Promise<{ id: string; displayName: string | null }> {
  return apiJsonRequest("PATCH", `/identities/${id}`, { displayName });
}

export function splitFace(faceId: string): Promise<{ identityId: string }> {
  return apiJsonRequest("POST", `/faces/${faceId}/split`);
}

export function reprocessPhoto(id: string): Promise<PhotoDetail> {
  return apiJsonRequest("POST", `/photos/${id}/reprocess`);
}

export function selectRegion(
  photoId: string,
  bbox: BoundingBox,
  action: SelectRegionAction,
): Promise<SelectRegionResponseBody> {
  return apiJsonRequest("POST", `/photos/${photoId}/select-region`, {
    bbox,
    action,
  });
}

export function backfillPhotos(): Promise<BackfillResponseBody> {
  return apiJsonRequest("POST", "/photos/backfill");
}

export function getDeveloperStats(): Promise<DeveloperStatsResponseBody> {
  return apiFetch<DeveloperStatsResponseBody>("/developer/stats");
}

export function getFailedPhotos(): Promise<FailedPhotoSummary[]> {
  return apiFetch<FailedPhotoSummary[]>("/developer/failed-photos");
}

export function retryFailedPhoto(id: string): Promise<RetryPhotoResponseBody> {
  return apiJsonRequest("POST", `/developer/failed-photos/${id}/retry`);
}

export function retryAllFailedPhotos(): Promise<RetryAllPhotosResponseBody> {
  return apiJsonRequest("POST", "/developer/failed-photos/retry-all");
}
