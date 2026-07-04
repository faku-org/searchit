import { desc } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { LocationSummary } from "@searchit/shared";
import { db } from "../db/client";
import { locations } from "../db/schema";

export const locationsRoutes = new Elysia({ prefix: "/locations" })
  .get("/", async (): Promise<LocationSummary[]> => {
    const rows = await db
      .select()
      .from(locations)
      .orderBy(desc(locations.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
    }));
  })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const [created] = await db
          .insert(locations)
          .values({ name: body.name, lat: body.lat, lon: body.lon })
          .returning();

        if (!created) {
          set.status = 500;
          return { error: "Failed to create location" };
        }

        const response: LocationSummary = {
          id: created.id,
          name: created.name,
          lat: created.lat,
          lon: created.lon,
        };
        return response;
      } catch {
        set.status = 409;
        return { error: `A location named "${body.name}" already exists` };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        lat: t.Number(),
        lon: t.Number(),
      }),
    },
  );
