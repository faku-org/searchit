import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const photoStatusEnum = pgEnum("photo_status", [
  "pending",
  "processed",
  "failed",
]);

export interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const eventCategoryEnum = pgEnum("event_category", [
  "sports",
  "vacation",
  "general",
  "custom",
]);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  category: eventCategoryEnum("category").notNull().default("general"),
  customOcrMinConfidence: real("custom_ocr_min_confidence"),
  customFaceMatchMaxDistance: real("custom_face_match_max_distance"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    originalPath: text("original_path").notNull().unique(),
    previewPath: text("preview_path"),
    filename: text("filename").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    gpsLat: doublePrecision("gps_lat"),
    gpsLon: doublePrecision("gps_lon"),
    cameraModel: text("camera_model"),
    width: integer("width"),
    height: integer("height"),
    status: photoStatusEnum("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    // Set when status transitions to "processed" -- distinct from createdAt
    // (row-insert time) so the Developer tab's "indexed in the last N
    // minutes" stat reflects actual completion time, not queue time.
    processedAt: timestamp("processed_at", { withTimezone: true }),
    recognizedText: text("recognized_text"),
    // Manually-assigned identifier (replaces the old auto-detected bib
    // number) -- not unique, since several photos of the same person/id are
    // expected, same as bib numbers were.
    customId: text("custom_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("photos_event_id_idx").on(table.eventId),
    index("photos_taken_at_idx").on(table.takenAt),
    index("photos_gps_idx").on(table.gpsLat, table.gpsLon),
    index("photos_status_idx").on(table.status),
    index("photos_custom_id_idx").on(table.customId),
  ],
);

/**
 * Everything below is reserved for Phase 2/3 (face roster + distinctive-elements
 * search). Created now so the pgvector extension and vector columns exist from the
 * first migration and later phases don't need destructive schema changes.
 */

export const identities = pgTable("identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const faceEmbeddings = pgTable(
  "face_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    thumbnailPath: text("thumbnail_path"),
    bbox: jsonb("bbox").$type<Bbox>(),
    confidence: real("confidence").notNull(),
    embedding: vector("embedding", { dimensions: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("face_embeddings_photo_id_idx").on(table.photoId),
    index("face_embeddings_identity_id_idx").on(table.identityId),
  ],
);

export const imageEmbeddings = pgTable("image_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  photoId: uuid("photo_id")
    .notNull()
    .references(() => photos.id, { onDelete: "cascade" })
    .unique(),
  embedding: vector("embedding", { dimensions: 512 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const eventsRelations = relations(events, ({ many }) => ({
  photos: many(photos),
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
  event: one(events, { fields: [photos.eventId], references: [events.id] }),
  faceEmbeddings: many(faceEmbeddings),
}));

export const faceEmbeddingsRelations = relations(faceEmbeddings, ({ one }) => ({
  photo: one(photos, {
    fields: [faceEmbeddings.photoId],
    references: [photos.id],
  }),
  identity: one(identities, {
    fields: [faceEmbeddings.identityId],
    references: [identities.id],
  }),
}));
