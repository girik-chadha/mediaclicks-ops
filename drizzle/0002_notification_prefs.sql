ALTER TABLE "users" ADD COLUMN "daily_digest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_time" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reminder_lead_minutes" integer DEFAULT 30 NOT NULL;