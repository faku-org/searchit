CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
DROP INDEX "bib_detections_bib_number_idx";--> statement-breakpoint
DROP INDEX "bib_detections_photo_id_idx";--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "custom_id" text;--> statement-breakpoint
CREATE INDEX "photos_custom_id_idx" ON "photos" USING btree ("custom_id");