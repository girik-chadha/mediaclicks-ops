# ADR 0006 — Put the database and the functions near the people using them

**Status:** proposed — needs a new Supabase project, which cannot be automated
**Date:** 2026-08-02

## Context

MediaClicks is in Dubai. The current deployment is not.

| | Region | Distance from Dubai |
|---|---|---|
| Supabase | `ap-southeast-1` (Singapore) | ~5,900 km |
| Vercel functions | `sin1` (Singapore) | ~5,900 km |

Measured from a laptop in Dubai against the production database, a warm
`SELECT 1` — no work, no rows — takes **159ms**. That is the floor for every
query. The functions sit beside the database, so their queries are fast, but
every page request still crosses to Singapore and back.

This is the dominant cost. A page making three round trips inside `sin1` is
fine; the trip to `sin1` in the first place is not.

## Decision

Move both to the Gulf, or failing that to Europe:

| | From | To |
|---|---|---|
| Supabase | `ap-southeast-1` | `me-central-1` (UAE), else `eu-central-1` (Frankfurt) |
| Vercel `regions` | `sin1` | `dxb1` (Dubai), else `fra1` |

They must move together. Functions far from the database pay the latency once
per query; users far from the functions pay it once per request. Both near the
users is the only arrangement that is fast for a single-office agency.

## Why this has not been done

Supabase cannot move a project between regions. It means creating a new
project, running the migrations, re-seeding, and repointing `DATABASE_URL`.

The reason to do it **now** rather than later is size. The database currently
holds three accounts, one client, a handful of meetings and one channel — the
move is a fifteen-minute job with nothing to lose. Every week of real use
makes it a data migration instead.

## Steps

1. Create a Supabase project in `me-central-1`.
2. Point `.env.local` at it (transaction pooler, port 6543, password
   percent-encoded) and run `npm run db:migrate && npm run db:seed`.
3. Set `regions: ["dxb1"]` in `vercel.json`.
4. Update `DATABASE_URL` in Vercel and redeploy.
5. Sign in, confirm, then delete the Singapore project.

If `me-central-1` is unavailable on the plan, `eu-central-1` with `fra1` is
roughly 4,800 km closer than Singapore and is the fallback.

## Consequences

- One migration window, with almost nothing to migrate.
- Every subsequent change is cheaper to feel: at 159ms per round trip an
  accidental N+1 is invisible in development and painful in Dubai. Closer
  infrastructure does not excuse the N+1 — the one in `listConversations` was
  fixed rather than hidden — but it stops geography masking ordinary work.

## Rejected alternative

**Leave it and cache harder.** Caching helps repeat reads and does nothing for
the first load of a screen someone opens sixty times a day, which is the
complaint. It also trades correctness for speed on a product whose entire job
is telling people what is true right now.
