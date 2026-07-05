import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  CreateEventResponseBody,
  EventSummary,
  UpdateEventResponseBody,
} from "@searchit/shared";
import { db } from "../db/client";
import { events, photos } from "../db/schema";
import { enqueue } from "../ingest/queue";
import { reprocessPhoto } from "../ingest/reprocess";

// Recomputed from env here rather than imported from index.ts, same pattern
// as PREVIEW_DIR in routes/developer.ts -- index.ts already validated this is
// set at boot.
const WATCH_DIR = path.resolve(process.env.SEARCHIT_WATCH_DIR ?? "");
const PREVIEW_DIR = path.resolve(process.env.SEARCHIT_PREVIEW_DIR ?? "");
const FACE_THUMBNAIL_DIR = path.resolve(
  process.env.SEARCHIT_FACE_THUMBNAIL_DIR ?? "",
);

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "event"
  );
}

export const eventsRoutes = new Elysia({ prefix: "/events" })
  .get("/", async (): Promise<EventSummary[]> => {
    const rows = await db
      .select({
        id: events.id,
        name: events.name,
        slug: events.slug,
        startsAt: events.startsAt,
        createdAt: events.createdAt,
        category: events.category,
        customOcrMinConfidence: events.customOcrMinConfidence,
        customFaceMatchMaxDistance: events.customFaceMatchMaxDistance,
        photoCount: sql<number>`count(${photos.id})`.mapWith(Number),
      })
      .from(events)
      .leftJoin(photos, eq(photos.eventId, events.id))
      .groupBy(events.id)
      .orderBy(desc(events.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      startsAt: row.startsAt ? row.startsAt.toISOString() : null,
      photoCount: row.photoCount,
      category: row.category,
      customOcrMinConfidence: row.customOcrMinConfidence,
      customFaceMatchMaxDistance: row.customFaceMatchMaxDistance,
    }));
  })
  .post(
    "/",
    async ({ body, set }): Promise<CreateEventResponseBody | { error: string }> => {
      const slug = body.slug ? slugify(body.slug) : slugify(body.name);

      try {
        const [created] = await db
          .insert(events)
          .values({
            name: body.name,
            slug,
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
            category: body.category ?? "general",
            customOcrMinConfidence: body.customOcrMinConfidence ?? null,
            customFaceMatchMaxDistance: body.customFaceMatchMaxDistance ?? null,
          })
          .returning();

        if (!created) {
          set.status = 500;
          return { error: "Failed to create event" };
        }

        // The watcher already scopes ingest by "immediate subfolder name under
        // the watch dir" (see ingest/watcher.ts), so creating this folder now
        // means dropping files into it just works -- no need to know the slug
        // or create the folder by hand.
        const folderPath = path.join(WATCH_DIR, created.slug);
        await mkdir(folderPath, { recursive: true });

        return {
          id: created.id,
          name: created.name,
          slug: created.slug,
          startsAt: created.startsAt ? created.startsAt.toISOString() : null,
          photoCount: 0,
          category: created.category,
          customOcrMinConfidence: created.customOcrMinConfidence,
          customFaceMatchMaxDistance: created.customFaceMatchMaxDistance,
          folderPath,
        };
      } catch {
        set.status = 409;
        return { error: `An event with slug "${slug}" already exists` };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        slug: t.Optional(t.String()),
        startsAt: t.Optional(t.String()),
        category: t.Optional(
          t.Union([
            t.Literal("sports"),
            t.Literal("vacation"),
            t.Literal("general"),
            t.Literal("custom"),
          ]),
        ),
        customOcrMinConfidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
        customFaceMatchMaxDistance: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
      }),
    },
  )
  .patch(
    "/:id",
    async ({ params, body, set }): Promise<UpdateEventResponseBody | { error: string }> => {
      const [updated] = await db
        .update(events)
        .set({
          category: body.category,
          customOcrMinConfidence:
            body.category === "custom" ? (body.customOcrMinConfidence ?? null) : null,
          customFaceMatchMaxDistance:
            body.category === "custom" ? (body.customFaceMatchMaxDistance ?? null) : null,
        })
        .where(eq(events.id, params.id))
        .returning();

      if (!updated) {
        set.status = 404;
        return { error: "Event not found" };
      }

      const [photoCountRow] = await db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(photos)
        .where(eq(photos.eventId, updated.id));

      // Switching an event's category is meant to fix photos already sitting
      // in the archive with the wrong weights (e.g. missed bib numbers), not
      // just photos ingested from here on -- so re-run every already-previewed
      // photo in this event through the shared bounded queue with the new
      // weights (resolveEventWeights re-reads the row's now-updated category).
      const candidates = await db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.eventId, updated.id), isNotNull(photos.previewPath)));

      for (const candidate of candidates) {
        enqueue(() =>
          reprocessPhoto(candidate.id, PREVIEW_DIR, FACE_THUMBNAIL_DIR),
        ).catch((error: unknown) => {
          console.error(`[event-category-change] failed for photo ${candidate.id}:`, error);
        });
      }

      return {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        startsAt: updated.startsAt ? updated.startsAt.toISOString() : null,
        photoCount: photoCountRow?.value ?? 0,
        category: updated.category,
        customOcrMinConfidence: updated.customOcrMinConfidence,
        customFaceMatchMaxDistance: updated.customFaceMatchMaxDistance,
        reprocessQueued: candidates.length,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        category: t.Union([
          t.Literal("sports"),
          t.Literal("vacation"),
          t.Literal("general"),
          t.Literal("custom"),
        ]),
        customOcrMinConfidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
        customFaceMatchMaxDistance: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
      }),
    },
  );
