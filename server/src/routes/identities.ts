import { mkdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, cosineDistance, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  FaceMatchCandidate,
  IdentitySummary,
  MatchFaceResponseBody,
  PhotoSummary,
} from "@searchit/shared";
import { db } from "../db/client";
import { faceEmbeddings, identities, photos } from "../db/schema";
import { detectFaces } from "../inference/client";

const MATCH_POOL_SIZE = 50;
const MAX_MATCH_CANDIDATES = 5;
const TEMP_MATCH_DIR = path.join(os.tmpdir(), "searchit-face-match");

interface IdentityDetailRow {
  id: string;
  displayName: string | null;
  photoCount: number;
  representativeFaceId: string | null;
}

/** Shared by the roster listing and the match-face results, which both need
 * display name / photo count / a representative thumbnail per identity. */
async function loadIdentityDetails(ids?: string[]): Promise<IdentityDetailRow[]> {
  return db
    .select({
      id: identities.id,
      displayName: identities.displayName,
      photoCount: sql<number>`count(distinct ${faceEmbeddings.photoId})`.mapWith(
        Number,
      ),
      representativeFaceId: sql<string>`min(${faceEmbeddings.id}::text)`,
    })
    .from(identities)
    .innerJoin(faceEmbeddings, eq(faceEmbeddings.identityId, identities.id))
    .where(ids ? inArray(identities.id, ids) : undefined)
    .groupBy(identities.id, identities.displayName);
}

function toIdentitySummary(row: IdentityDetailRow): IdentitySummary {
  return {
    id: row.id,
    displayName: row.displayName,
    photoCount: row.photoCount,
    thumbnailUrl: row.representativeFaceId
      ? `/faces/${row.representativeFaceId}/thumbnail`
      : null,
  };
}

/** Nearest identity per candidate face, deduped to that identity's single closest face. */
async function rankIdentitiesByFace(
  embedding: number[],
): Promise<{ identityId: string; distance: number }[]> {
  const nearestFaces = await db
    .select({
      identityId: faceEmbeddings.identityId,
      distance: cosineDistance(faceEmbeddings.embedding, embedding).mapWith(
        Number,
      ),
    })
    .from(faceEmbeddings)
    .where(isNotNull(faceEmbeddings.identityId))
    .orderBy(cosineDistance(faceEmbeddings.embedding, embedding))
    .limit(MATCH_POOL_SIZE);

  const bestDistanceByIdentity = new Map<string, number>();
  for (const row of nearestFaces) {
    if (!row.identityId) continue;
    const existing = bestDistanceByIdentity.get(row.identityId);
    if (existing === undefined || row.distance < existing) {
      bestDistanceByIdentity.set(row.identityId, row.distance);
    }
  }

  return [...bestDistanceByIdentity.entries()]
    .map(([identityId, distance]) => ({ identityId, distance }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_MATCH_CANDIDATES);
}

async function saveUploadToTemp(file: File): Promise<string> {
  await mkdir(TEMP_MATCH_DIR, { recursive: true });
  const extension = file.type === "image/png" ? "png" : "jpg";
  const tempPath = path.join(
    TEMP_MATCH_DIR,
    `${crypto.randomUUID()}.${extension}`,
  );
  await Bun.write(tempPath, file);
  return tempPath;
}

export const identitiesRoutes = new Elysia({ prefix: "/identities" })
  .get("/", async (): Promise<IdentitySummary[]> => {
    const rows = await loadIdentityDetails();
    return rows
      .sort((a, b) => b.photoCount - a.photoCount)
      .map(toIdentitySummary);
  })
  .post(
    "/match-face",
    async ({ body, set }): Promise<MatchFaceResponseBody | { error: string }> => {
      const tempPath = await saveUploadToTemp(body.photo);
      try {
        const { faces } = await detectFaces(tempPath);
        if (faces.length === 0) {
          set.status = 422;
          return { error: "No face detected in that photo" };
        }

        const [bestFace] = [...faces].sort(
          (a, b) => b.confidence - a.confidence,
        );
        const ranked = await rankIdentitiesByFace(bestFace!.embedding);
        if (ranked.length === 0) return { candidates: [] };

        const details = await loadIdentityDetails(
          ranked.map((r) => r.identityId),
        );
        const detailsById = new Map(details.map((row) => [row.id, row]));

        const candidates: FaceMatchCandidate[] = ranked
          .map((r): FaceMatchCandidate | null => {
            const detail = detailsById.get(r.identityId);
            if (!detail) return null;
            return {
              identityId: r.identityId,
              displayName: detail.displayName,
              distance: r.distance,
              photoCount: detail.photoCount,
              thumbnailUrl: detail.representativeFaceId
                ? `/faces/${detail.representativeFaceId}/thumbnail`
                : null,
            };
          })
          .filter((c): c is FaceMatchCandidate => c !== null);

        return { candidates };
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    },
    { body: t.Object({ photo: t.File() }) },
  )
  .get(
    "/:id/photos",
    async ({ params }): Promise<PhotoSummary[]> => {
      const rows = await db
        .select({
          id: photos.id,
          eventId: photos.eventId,
          filename: photos.filename,
          takenAt: photos.takenAt,
          gpsLat: photos.gpsLat,
          gpsLon: photos.gpsLon,
          status: photos.status,
          customId: photos.customId,
          width: photos.width,
          height: photos.height,
        })
        .from(photos)
        .innerJoin(
          faceEmbeddings,
          and(
            eq(faceEmbeddings.photoId, photos.id),
            eq(faceEmbeddings.identityId, params.id),
          ),
        );

      // A person can have more than one matched face in the same photo, which
      // would otherwise fan out into duplicate rows for that photo.
      const uniqueByPhotoId = [...new Map(rows.map((row) => [row.id, row])).values()];

      return uniqueByPhotoId
        .sort(
          (a, b) => (b.takenAt?.getTime() ?? 0) - (a.takenAt?.getTime() ?? 0),
        )
        .map(
          (row): PhotoSummary => ({
            id: row.id,
            eventId: row.eventId,
            filename: row.filename,
            takenAt: row.takenAt ? row.takenAt.toISOString() : null,
            gpsLat: row.gpsLat,
            gpsLon: row.gpsLon,
            status: row.status,
            customId: row.customId,
            width: row.width,
            height: row.height,
          }),
        );
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const [updated] = await db
        .update(identities)
        .set({ displayName: body.displayName })
        .where(eq(identities.id, params.id))
        .returning();

      if (!updated) {
        set.status = 404;
        return { error: "Identity not found" };
      }

      return { id: updated.id, displayName: updated.displayName };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ displayName: t.Nullable(t.String()) }),
    },
  );
