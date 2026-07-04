const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111.32;

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Cheap pre-filter box for an indexed range query; refine with haversineDistanceKm. */
export function boundingBox(
  lat: number,
  lon: number,
  radiusKm: number,
): BoundingBox {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const cos = Math.cos(toRad(lat));
  const lonDelta = radiusKm / (KM_PER_DEGREE_LAT * (cos === 0 ? 1 : cos));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
