import { desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { EventSummary } from "@searchit/shared";
import { db } from "../db/client";
import { events, photos } from "../db/schema";

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
    }));
  })
  .post(
    "/",
    async ({ body, set }) => {
      const slug = body.slug ? slugify(body.slug) : slugify(body.name);

      try {
        const [created] = await db
          .insert(events)
          .values({
            name: body.name,
            slug,
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
          })
          .returning();

        if (!created) {
          set.status = 500;
          return { error: "Failed to create event" };
        }

        const response: EventSummary = {
          id: created.id,
          name: created.name,
          slug: created.slug,
          startsAt: created.startsAt ? created.startsAt.toISOString() : null,
          photoCount: 0,
        };
        return response;
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
      }),
    },
  );
