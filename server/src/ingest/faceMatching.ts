import { cosineDistance, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { faceEmbeddings, identities } from "../db/schema";

// Cosine-distance cutoff for "same person as an existing identity" vs. "new
// identity". Needs tuning against real ArcFace embeddings once face
// recognition runs for real -- see inference/README.md.
const FACE_MATCH_MAX_DISTANCE = Number(
  process.env.FACE_MATCH_MAX_DISTANCE ?? "0.6",
);

/**
 * Finds the nearest already-identified face across the whole archive (no event
 * filter -- this is what makes identity persist across events) and reuses its
 * identity if close enough, otherwise creates a new identity.
 */
export async function resolveIdentityForEmbedding(
  embedding: number[],
  maxDistance: number = FACE_MATCH_MAX_DISTANCE,
): Promise<string> {
  const [nearest] = await db
    .select({
      identityId: faceEmbeddings.identityId,
      distance: cosineDistance(faceEmbeddings.embedding, embedding).mapWith(
        Number,
      ),
    })
    .from(faceEmbeddings)
    .where(isNotNull(faceEmbeddings.identityId))
    .orderBy(cosineDistance(faceEmbeddings.embedding, embedding))
    .limit(1);

  if (nearest?.identityId && nearest.distance <= maxDistance) {
    return nearest.identityId;
  }

  const [created] = await db.insert(identities).values({}).returning();
  if (!created) throw new Error("Failed to create identity");
  return created.id;
}
