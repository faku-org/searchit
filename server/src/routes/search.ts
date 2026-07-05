import { and, between, eq, gte, ilike, lte } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { PhotoSummary } from "@searchit/shared";
import { db } from "../db/client";
import { imageEmbeddings, photos } from "../db/schema";
import { boundingBox, haversineDistanceKm } from "../lib/geo";
import { cosineSimilarity } from "../lib/vector";
import { embedText } from "../inference/client";

const RESULT_LIMIT = 500;

export const searchRoutes = new Elysia().get(
  "/search",
  async ({ query, set }) => {
    const conditions = [];

    if (query.eventId) conditions.push(eq(photos.eventId, query.eventId));
    if (query.from) conditions.push(gte(photos.takenAt, new Date(query.from)));
    if (query.to) conditions.push(lte(photos.takenAt, new Date(query.to)));
    if (query.customId) conditions.push(eq(photos.customId, query.customId));
    if (query.sceneText) {
      conditions.push(ilike(photos.recognizedText, `%${query.sceneText}%`));
    }

    // A named location resolves to the same lat/lon + radius filter as
    // typing in raw coordinates -- it's just a friendlier way to pick the
    // point.
    let geoOrigin: { lat: number; lon: number } | null = null;
    if (query.locationId) {
      const location = await db.query.locations.findFirst({
        where: (row, { eq }) => eq(row.id, query.locationId!),
      });
      if (!location) {
        set.status = 404;
        return { error: "Location not found" };
      }
      geoOrigin = { lat: location.lat, lon: location.lon };
    } else if (query.lat !== undefined && query.lon !== undefined) {
      geoOrigin = { lat: query.lat, lon: query.lon };
    }

    const hasGeoFilter = geoOrigin !== null && query.radiusKm !== undefined;
    if (hasGeoFilter) {
      const box = boundingBox(geoOrigin!.lat, geoOrigin!.lon, query.radiusKm!);
      conditions.push(between(photos.gpsLat, box.minLat, box.maxLat));
      conditions.push(between(photos.gpsLon, box.minLon, box.maxLon));
    }

    // Fetched up-front (not per-row) since it's one call to the text encoder,
    // reused for every row's ranking below.
    const visualQueryEmbedding = query.visualQuery
      ? (await embedText(query.visualQuery)).embedding
      : null;

    const rows = await db
      .select({
        id: photos.id,
        eventId: photos.eventId,
        filename: photos.filename,
        takenAt: photos.takenAt,
        createdAt: photos.createdAt,
        gpsLat: photos.gpsLat,
        gpsLon: photos.gpsLon,
        status: photos.status,
        customId: photos.customId,
        imageEmbedding: imageEmbeddings.embedding,
      })
      .from(photos)
      .leftJoin(imageEmbeddings, eq(imageEmbeddings.photoId, photos.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    let results = rows;

    if (hasGeoFilter) {
      results = results.filter(
        (row) =>
          row.gpsLat !== null &&
          row.gpsLon !== null &&
          haversineDistanceKm(
            geoOrigin!.lat,
            geoOrigin!.lon,
            row.gpsLat,
            row.gpsLon,
          ) <= query.radiusKm!,
      );
    }

    if (visualQueryEmbedding) {
      // Photos with no image embedding yet (not processed, or embedding failed)
      // can't be ranked against the query, so they drop out of a visual search.
      results = results
        .filter((row) => row.imageEmbedding !== null)
        .sort(
          (a, b) =>
            cosineSimilarity(b.imageEmbedding!, visualQueryEmbedding) -
            cosineSimilarity(a.imageEmbedding!, visualQueryEmbedding),
        );
    } else {
      // Sorted by ingest time (createdAt), not EXIF takenAt -- a batch of
      // newly-arrived photos should surface immediately regardless of
      // whether their taken-at metadata is missing, wrong, or just older
      // than photos ingested earlier from a different source.
      results = [...results].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    }

    return results.slice(0, RESULT_LIMIT).map(
      (row): PhotoSummary => ({
        id: row.id,
        eventId: row.eventId,
        filename: row.filename,
        takenAt: row.takenAt ? row.takenAt.toISOString() : null,
        gpsLat: row.gpsLat,
        gpsLon: row.gpsLon,
        status: row.status,
        customId: row.customId,
      }),
    );
  },
  {
    query: t.Object({
      eventId: t.Optional(t.String()),
      customId: t.Optional(t.String()),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
      lat: t.Optional(t.Numeric()),
      lon: t.Optional(t.Numeric()),
      radiusKm: t.Optional(t.Numeric()),
      locationId: t.Optional(t.String()),
      visualQuery: t.Optional(t.String()),
      sceneText: t.Optional(t.String()),
    }),
  },
);
