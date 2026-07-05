import { mkdir } from "node:fs/promises";
import path from "node:path";
import { desc } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { CreateEventResponseBody, EventSummary } from "@searchit/shared";
import { db } from "../db/client";
import { events } from "../db/schema";

// Recomputed from env here rather than imported from index.ts, same pattern
// as PREVIEW_DIR in routes/developer.ts -- index.ts already validated this is
// set at boot.
const WATCH_DIR = path.resolve(process.env.SEARCHIT_WATCH_DIR ?? "");

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
      .select()
      .from(events)
      .orderBy(desc(events.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      startsAt: row.startsAt ? row.startsAt.toISOString() : null,
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
      }),
    },
  );
