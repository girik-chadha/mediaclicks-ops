-- Close the PostgREST hole (see docs/adr/0009-rls-without-policies.md).
--
-- Supabase exposes every table in `public` over a REST API authenticated
-- with the project's anon key, which is designed to be published. On a
-- fresh project the `anon` and `authenticated` roles are granted full DML —
-- SELECT, INSERT, UPDATE, DELETE and TRUNCATE — and row-level security is
-- off. Together those mean anyone holding that key can read every password
-- hash in `users`, every client record, and can empty the database.
--
-- This app never uses that API. It connects as `postgres` over the pooler,
-- so nothing here changes what the app can do: the owner of a table
-- bypasses its row-level security unless FORCE is set, and FORCE is
-- deliberately not set below.
--
-- Two independent locks, because one of them failing open is a total
-- breach:
--
--   1. RLS enabled with **no policies at all**. Default-deny. A policy that
--      tried to express "the app can see everything" would be a lie — the
--      app is not the role being restricted — and each policy written is
--      another thing that can be written wrongly.
--   2. Privileges revoked outright. If someone later disables RLS on a
--      table, the grants are still gone and the API still returns nothing.

-- ── 1. Row-level security, default-deny ────────────────────────────────
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── 2. Take the privileges away as well ────────────────────────────────
--
-- Guarded on the roles existing. `anon` and `authenticated` are Supabase's,
-- not Postgres's — a plain `postgres://localhost` install has neither, and
-- an unguarded REVOKE would abort the migration there. RLS above is
-- portable; this half is Supabase-specific and says so.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    -- Without this the next CREATE TABLE is exposed again: Supabase sets
    -- default privileges granting these roles everything `postgres`
    -- creates. This is the line that stops the problem coming back.
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END $$;
