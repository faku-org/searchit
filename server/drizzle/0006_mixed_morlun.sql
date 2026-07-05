CREATE TYPE "public"."event_category" AS ENUM('sports', 'vacation', 'general', 'custom');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "category" "event_category" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "custom_ocr_min_confidence" real;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "custom_face_match_max_distance" real;