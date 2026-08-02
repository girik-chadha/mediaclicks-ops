ALTER TABLE "users" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';--> statement-breakpoint
-- Correct the accounts created under the old default. Scoped to that exact
-- value, so anyone who has already chosen their own zone keeps it.
UPDATE "users" SET "timezone" = 'Asia/Kolkata' WHERE "timezone" = 'Asia/Dubai';
