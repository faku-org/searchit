CREATE TYPE "public"."photo_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "bib_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"bib_number" text NOT NULL,
	"confidence" real NOT NULL,
	"bbox" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"starts_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "face_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"identity_id" uuid,
	"thumbnail_path" text,
	"bbox" jsonb,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_embeddings_photo_id_unique" UNIQUE("photo_id")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"original_path" text NOT NULL,
	"preview_path" text,
	"filename" text NOT NULL,
	"taken_at" timestamp with time zone,
	"gps_lat" double precision,
	"gps_lon" double precision,
	"camera_model" text,
	"width" integer,
	"height" integer,
	"status" "photo_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_original_path_unique" UNIQUE("original_path")
);
--> statement-breakpoint
ALTER TABLE "bib_detections" ADD CONSTRAINT "bib_detections_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_embeddings" ADD CONSTRAINT "face_embeddings_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_embeddings" ADD CONSTRAINT "face_embeddings_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_embeddings" ADD CONSTRAINT "image_embeddings_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bib_detections_bib_number_idx" ON "bib_detections" USING btree ("bib_number");--> statement-breakpoint
CREATE INDEX "bib_detections_photo_id_idx" ON "bib_detections" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "face_embeddings_photo_id_idx" ON "face_embeddings" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "face_embeddings_identity_id_idx" ON "face_embeddings" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "photos_event_id_idx" ON "photos" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "photos_taken_at_idx" ON "photos" USING btree ("taken_at");--> statement-breakpoint
CREATE INDEX "photos_gps_idx" ON "photos" USING btree ("gps_lat","gps_lon");--> statement-breakpoint
CREATE INDEX "photos_status_idx" ON "photos" USING btree ("status");