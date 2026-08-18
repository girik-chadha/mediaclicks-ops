CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_user_created_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
-- ADR 0009: every table in `public` is default-deny. 0005 revoked the
-- default *privileges* so a new table is not granted to anon, but RLS is
-- per-table and has to be enabled on each one as it is created. Without
-- this line the table is not exposed through PostgREST today, and becomes
-- exposed the moment anyone re-grants. tests/db/rls.test.ts fails if this
-- is forgotten.
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
