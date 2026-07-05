import type { LocationSummary } from "@searchit/shared";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Finds the closest tagged location to a GPS point, if any is within
 * `maxKm`. Used to show a photo's "Taken at" as a human name (e.g. "Finish
 * line") instead of raw coordinates whenever the photographer has already
 * tagged that spot.
 */
export function findNearestLocation(
  lat: number,
  lon: number,
  locations: LocationSummary[],
  maxKm: number,
): LocationSummary | null {
  let nearest: LocationSummary | null = null;
  let nearestDistance = Infinity;

  for (const location of locations) {
    const distance = haversineKm(lat, lon, location.lat, location.lon);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = location;
    }
  }

  return nearestDistance <= maxKm ? nearest : null;
}
