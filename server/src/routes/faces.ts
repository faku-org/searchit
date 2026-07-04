import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { faceEmbeddings, identities } from "../db/schema";

export const facesRoutes = new Elysia({ prefix: "/faces" })
  .get(
    "/:id/thumbnail",
    async ({ params, set }) => {
      const face = await db.query.faceEmbeddings.findFirst({
        where: (row, { eq }) => eq(row.id, params.id),
      });

      if (!face?.thumbnailPath) {
        set.status = 404;
        return { error: "Thumbnail not available" };
      }

      return Bun.file(face.thumbnailPath);
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/:id/split",
    async ({ params, set }) => {
      const face = await db.query.faceEmbeddings.findFirst({
        where: (row, { eq }) => eq(row.id, params.id),
      });

      if (!face) {
        set.status = 404;
        return { error: "Face not found" };
      }

      const [newIdentity] = await db.insert(identities).values({}).returning();
      if (!newIdentity) {
        set.status = 500;
        return { error: "Failed to create identity" };
      }

      await db
        .update(faceEmbeddings)
        .set({ identityId: newIdentity.id })
        .where(eq(faceEmbeddings.id, params.id));

      return { identityId: newIdentity.id };
    },
    { params: t.Object({ id: t.String() }) },
  );
