CREATE TABLE "login_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"remember" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_challenge_user_created_idx" ON "login_challenges" USING btree ("user_id","created_at");--> statement-breakpoint
-- ADR 0009: every table in `public` is default-deny. 0005 revoked the
-- default *privileges* so a new table is not granted to anon, but RLS is
-- per-table and has to be enabled on each one as it is created. This table
-- holds live second-factor codes, so an accidental re-grant without it would
-- expose exactly the values that stand between a stolen password and a
-- session. tests/db/rls.test.ts fails if this is forgotten.
ALTER TABLE "login_challenges" ENABLE ROW LEVEL SECURITY;
