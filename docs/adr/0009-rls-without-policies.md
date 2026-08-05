# ADR 0009 — Row-level security with no policies

**Status:** accepted
**Date:** 2026-08-04

## Context

Supabase emailed a critical alert: every table in `public` was readable and
writable by anyone with the project URL, because row-level security was off.

Checking it directly was worse than the email said. All 17 tables had RLS
disabled, and the `anon` and `authenticated` roles held **SELECT, INSERT,
UPDATE, DELETE, TRUNCATE and REFERENCES** on every one of them.

That is not a theoretical exposure. Supabase serves `public` over PostgREST,
authenticated by the project's anon key — a key designed to be published, and
which appears in client bundles, screenshots and support threads as a matter
of course. Anyone holding it could have read every row of `users` including
`password_hash`, read every client's contact details, or issued a `TRUNCATE`.

The default is not Supabase being careless; it is Supabase assuming the
browser talks to the database, which is the shape their client library
encourages. This app is the other shape: a Next.js server connects as
`postgres` over the pooler, and the browser never holds a database
credential at all. So the entire PostgREST surface is attack surface with no
corresponding feature.

## Decision

**Enable RLS on every table, and write no policies.**

With RLS on and no policy present, Postgres denies every row to every role
the policy system applies to. That is the whole security model, expressed by
the absence of code.

The app is unaffected because it connects as the role that *owns* the
tables, and an owner bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set.
It is deliberately not set. This is the one line in the migration where
getting it wrong locks the application out of its own database, so it is
worth stating plainly: `ENABLE` restricts everyone else, `FORCE` would also
restrict us.

**Revoke the privileges as well.**

RLS and the grants are independent locks, and the migration takes both. If
someone later disables RLS on one table — through the dashboard, or a
migration written in a hurry — the grants are still gone and PostgREST still
returns nothing. Neither lock depends on the other holding.

**Revoke the default privileges too.**

Supabase sets `ALTER DEFAULT PRIVILEGES` so that anything `postgres` creates
is granted to `anon` and `authenticated` automatically. Without revoking
that, the next `CREATE TABLE` re-opens the hole and nobody notices until the
next alert email. This is the line that stops the problem recurring, rather
than fixing this instance of it.

**Guarded on the roles existing.**

`anon` and `authenticated` are Supabase's, not Postgres's. An unguarded
`REVOKE` aborts the migration on a plain install — including the
`postgres://localhost` in `.env.example` — so the privilege half is wrapped
in a role-existence check. The RLS half is standard Postgres and portable as
written.

## Why not policies

The obvious alternative is a policy per table expressing the app's access
rules — `org_id = current_setting('app.org')`, that shape.

It would be security theatre here. The app does not authenticate as `anon`
or `authenticated`; it authenticates as `postgres` and bypasses policies
entirely. A policy would therefore describe a caller that does not exist,
while the real authorization — `can()` and `requirePermission()` — carries
on happening in the application, where it already has a session and a
permission set to reason about and 400-odd tests over it.

Two definitions of who may see what, one of them enforced and one of them
decorative, is worse than one. Every policy written is another thing that
can be written wrongly, and a wrong policy that grants too much looks
exactly like a right one until someone reads it.

The org-scoping guarantee (ADR 0004) is not weakened: it never rested on the
database refusing cross-tenant reads, it rests on `inOrg()` being the only
way a query gets built.

## Consequences

**Good**

- The REST API returns nothing to anyone, for every table, now and for
  tables added later.
- No application change, no policy to maintain, no `current_setting` plumbing
  to thread through a connection pool that reuses sessions.
- `tests/db/rls.test.ts` asserts the property rather than the migration: it
  applies every migration in the journal to embedded Postgres and fails if
  any table ends up without RLS. A table added later without one is a red
  test, not an email from Supabase.

**Costs, accepted**

- Nobody can use the Supabase dashboard's table editor or its REST API
  against this project without deliberately re-granting. That is the point,
  but it is a real loss of convenience for one-off inspection. `psql` and
  `npm run db:studio` still work — they connect as the owner.
- If this app ever grows a browser-side Supabase client, this ADR has to be
  revisited in full rather than patched around. Adding a permissive policy
  to unblock that would quietly undo the whole thing.
