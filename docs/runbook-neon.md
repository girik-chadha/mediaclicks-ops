# Moving the database to Neon

**Why:** the Supabase Free plan pauses a project after a 7-day quiet period
and needs a human to click Restore. That happened during development and it
is not something you can hand to a client. Neon's Free plan suspends idle
compute after 5 minutes too — but **resumes itself on the next connection**,
with no dashboard and no person involved.

| | Supabase Free | Neon Free |
|---|---|---|
| Idle behaviour | paused after ~7 quiet days | compute suspends after 5 min |
| Waking up | manual, from the dashboard | automatic, on connect |
| Point-in-time restore | none | 6 hours |
| Downloadable backups | none | — (use `backup.yml`) |
| Storage | 500 MB | 0.5 GB per project |

Neither has an SLA. For a client that matters more than either row above —
see *Who owns the account* at the end.

---

## What makes this cheap

This app uses nothing Supabase-specific. Verified, not assumed:

- no `@supabase/supabase-js` anywhere in `src/` or `scripts/`
- no Supabase Auth, Storage, Realtime or Edge Functions — sign-in is Auth.js
  against the app's own `users` table
- the only extension is `gen_random_uuid()`, built into Postgres 13+
- `src/server/db/index.ts` already detects a transaction pooler and turns off
  prepared statements accordingly, which is what Neon's pooled endpoint needs
- migration `0005`'s `REVOKE`s are wrapped in a role-existence check, so the
  Supabase-only `anon` and `authenticated` blocks simply do not run on Neon.
  The `ENABLE ROW LEVEL SECURITY` half is plain Postgres and still applies.

So the move is: create, migrate, copy, switch one variable.

---

## Steps

### 1. Create the project

Either the Neon console, or from Vercel:

```bash
vercel install neon
```

The Vercel route provisions the database, links it to the project and
injects `DATABASE_URL` as an environment variable automatically.

**Region:** `aws-ap-south-1` (Mumbai) — same reasoning as ADR 0006. The
database's distance is paid five or six times per page; the user's is paid
once.

### 2. Get the pooled connection string

Neon console → your project → **Connect** → **Connection string**, with
**Pooled connection** ticked. It looks like:

```
postgresql://<user>:<password>@ep-xxx-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require
```

Keep `-pooler` in it. The app opens a connection per request and the pooler
is what stops that exhausting the compute.

If the password contains `#`, `@`, `/` or `?`, percent-encode it — `#`
becomes `%23`.

### 3. Build the schema

```powershell
$env:DATABASE_URL = "<the Neon URL>"
npm run db:migrate
```

All 18 tables plus the RLS lockdown. Confirm the count:

```powershell
npm run db:studio
```

### 4. Copy the data across — only if the old project is awake

If Supabase is paused, restore it from the dashboard first. If there is
nothing in it worth keeping, skip to step 5 and seed fresh.

```powershell
$env:OLD_DATABASE_URL = "<the Supabase URL>"
$env:NEW_DATABASE_URL = "<the Neon URL>"
node scripts/copy-to-new-db.mjs --dry-run
node scripts/copy-to-new-db.mjs
```

The script computes insert order from the live foreign-key graph, so it
does not care which provider is on either end.

### 5. Switch over

- `.env.local` → `DATABASE_URL` = the Neon URL
- Vercel → Settings → Environment Variables → `DATABASE_URL` → the Neon URL
- GitHub → Settings → Secrets → `DATABASE_URL` → the Neon URL (for
  `backup.yml`)

Redeploy. Sign in. Open the calendar.

### 6. Keep the old one for a week

Do not delete the Supabase project immediately. Pause it. If something is
missing you will find out within a few days, and a paused project can be
restored; a deleted one cannot.

---

## What changes about the first cold request

Neon suspends compute after five minutes of no connections and resumes on
the next one. The resume is fast — a few hundred milliseconds — but it is
not zero, so the first page load after a quiet period is slower than the
rest. On the paid tiers scale-to-zero can be turned off.

Two things make this less visible than it sounds here: the notification
cron (step 13 of the go-live runbook) connects every five minutes, which
keeps the compute warm through the working day; and the whole team is in
one timezone, so quiet periods mostly happen overnight.

---

## Who owns the account

For a handover this matters more than any technical row above.

The Neon and Vercel accounts should be in the **client's** name, with you
added as a member. If both live under your login:

- they cannot pay for an upgrade without going through you
- they cannot get support
- they cannot stop working with you without losing their calendar

Neon and Vercel both support transferring a project to another team. Do it
before handover, not after.
