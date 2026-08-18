# Moving the database from Singapore to Mumbai

**Why:** the Supabase project is in `ap-southeast-1` (Singapore). The team is
in India and the owner is in Dubai. Loading one page is not one round trip —
the layout runs about three queries in sequence, the page two more — so every
millisecond of database distance is paid five or six times per page.

| Route | One round trip | ×6 per page |
|---|---|---|
| Dubai → Singapore | ~130 ms | ~800 ms |
| Dubai → Mumbai | ~40 ms | ~240 ms |
| Mumbai (app) → Mumbai (db) | ~2 ms | ~12 ms |

The third row is the point. **A user's distance costs one round trip; the
database's distance costs six.** Putting the app server in the same region as
the database is worth more than putting either one near a person. Moving the
database to Mumbai helps today because the app runs on a laptop in Dubai;
deploying the app to Mumbai later is what makes it feel instant for everyone.

Supabase cannot change a project's region in place. This creates a new
project and copies into it.

**Do this before you have production data worth losing.** Nothing here
touches the old project — it stays live and untouched until you change
`DATABASE_URL`, and switching back is one line.

---

## What makes this simple here

This app uses none of Supabase's own features. Auth is Auth.js against the
app's own `users` table; there is no Supabase Auth, no Storage, no Edge
Functions, and no extension beyond `gen_random_uuid()`. Everything that
matters is 17 tables in `public`, all created by the migrations in
`drizzle/`.

So the schema is rebuilt by running the migrations, not by copying — which
also means migration `0005_lock_down_public_schema.sql` runs on the new
project. That is the one that closes the PostgREST hole, and it would be very
easy to leave behind on the old server.

---

## Steps

### 1. Create the new project

Supabase dashboard → **New project**.

- **Region:** `South Asia (Mumbai) ap-south-1`
- Save the database password somewhere before leaving the page. It is shown
  once.

### 2. Get the new connection string

Project → **Connect** → **Connection string** → **Transaction pooler**
(port `6543`). It looks like:

```
postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

If the password contains `#`, `@`, `/` or `?`, percent-encode it — `#`
becomes `%23`. (Your current URL already does this, which is why it has
`%23%23` in it.)

### 3. Build the schema on the new project

From `mediaclicks-ops`, in PowerShell:

```powershell
$env:OLD_DATABASE_URL = "<your current Singapore URL from .env.local>"
$env:NEW_DATABASE_URL = "<the Mumbai URL from step 2>"

# Point drizzle at the new database just for this command
$env:DATABASE_URL = $env:NEW_DATABASE_URL
npm run db:migrate
```

This creates all 17 tables and applies the RLS lockdown.

### 4. Dry run the copy

```powershell
node scripts/copy-to-new-db.mjs --dry-run
```

Prints the tables in parent-before-child order and the row count it would
copy from each. Writes nothing. Check the numbers look like your data.

### 5. Copy

```powershell
node scripts/copy-to-new-db.mjs
```

It refuses to run if the new database already has rows, then verifies every
table's count matches when it finishes. **If it reports a mismatch, stop and
do not switch over.**

### 6. Check the security migration landed

```powershell
npm test -- rls
```

`tests/db/rls.test.ts` replays the migration journal and asserts every table
ends up with RLS on and no policies. It runs against a throwaway PGlite
database, so this confirms the migrations are correct, not the new server.
To confirm the *server*, in the Supabase SQL editor for the **new** project:

```sql
select tablename, rowsecurity
from pg_tables where schemaname = 'public' order by tablename;
```

All 17 should show `rowsecurity = true`.

### 7. Switch over

In `.env.local`, replace `DATABASE_URL` with the Mumbai URL. Then:

```powershell
npm run dev
```

Click through Calendar, Today, Clients, Chat. Confirm your data is there and
pages feel faster.

### 8. Disable the Data API on the new project

Same exposure as the old one, and a new project starts open again:
Project **Settings → API → Data API → disable**. The app connects directly
over the pooler and never uses PostgREST.

### 9. Keep the old project for a week

Do not delete it. If anything is missing you still have the original. Pause
it (Settings → General → Pause project) to stop it consuming quota, then
delete once you are satisfied.

---

## Rolling back

Put the old `DATABASE_URL` back in `.env.local` and restart. That is the
whole rollback — nothing in this runbook modifies the Singapore project.

---

## Afterwards: deploying near the database

Moving the database is half the win. The other half is not running the app
from a laptop in Dubai.

When you deploy, pin the app to Mumbai:

- **Vercel** — Project Settings → Functions → Region → `bom1` (Mumbai).
- **Anywhere else** — pick their Mumbai/`ap-south-1` region.

Then the six-round-trip page costs ~12 ms of database latency instead of
~800 ms, and each person pays their own distance exactly once.

Set the same environment variables there that `.env.local` holds:
`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` (your real domain), `CRON_SECRET`,
`GROQ_API_KEY`, and `RESEND_API_KEY` if you want client emails to send.
