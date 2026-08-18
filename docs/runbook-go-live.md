# Going live on Vercel

From a working development install to something the team signs into.

Read the **Before you start** section first. Two of its items are not
optional, and one of them is the reason this document exists.

---

## Before you start

### 1. Every secret in `.env.local` has been exposed

The database password, `AUTH_SECRET`, `CRON_SECRET` and the Groq key have all
appeared in a chat transcript during development. None of them may be carried
into production.

`AUTH_SECRET` matters most: it signs session cookies. Anyone holding it can
mint a valid session for any user id. Generate fresh values:

```powershell
npx auth secret                 # AUTH_SECRET
openssl rand -hex 32            # CRON_SECRET
```

Reset the database password in Supabase (Settings → Database → Reset
database password) and create a new Groq key at console.groq.com/keys.

Production gets new values. Development can keep the old ones — they only
protect demo data.

### 2. Meeting edit and cancel are unverified

They were broken for the whole of development by a query asking Postgres for
every meeting up to the year 275760. The fix is in and typechecks, but has
never been confirmed against a live database.

**Verify before the team depends on it.** In development: open a meeting,
rename it, save, hard-refresh, confirm the new name survived. Then cancel one
and confirm it shows as cancelled. If either fails, the terminal now names
the cause.

### 3. Disable the Supabase Data API

Settings → API → Data API → disable.

Supabase serves every table in `public` over PostgREST using the anon key,
which is designed to be published. Migration `0005` enables RLS so the API
returns nothing, but disabling it is the second lock. The app connects
directly over the pooler and never uses that API.

---

## Deploy

### 4. Push to GitHub

Everything must be committed, including the assistant's Groq integration —
`src/server/assistant/llm-planner.ts`, `src/lib/assistant/model-tools.ts`,
their test, and the `planner.ts` change. Those land together or a fresh clone
will not build.

Confirm `.env.local` is git-ignored and has never been committed:

```powershell
git check-ignore -v .env.local
git log --all --oneline -- .env.local
```

The second must print nothing. If it prints anything, the secrets are in
history and rotating them is no longer optional anywhere.

### 5. Import into Vercel

New Project → import the repository. Next.js is detected; the defaults are
right.

**Set the region to Mumbai before the first deploy** — Settings → Functions →
Region → `bom1`.

This is the single biggest performance decision. A page runs about five
sequential queries; in Mumbai next to the database each costs ~2 ms, from a
default US region each costs ~250 ms. Same code, roughly a second of
difference per page.

### 6. Environment variables

Settings → Environment Variables, for Production:

| Name | Value |
|---|---|
| `DATABASE_URL` | Mumbai pooler string, **new** password, `#` as `%23` |
| `AUTH_SECRET` | freshly generated |
| `AUTH_URL` | `https://your-domain.vercel.app` — the real URL |
| `CRON_SECRET` | freshly generated |
| `GROQ_API_KEY` | the new key |
| `SEED_ORG_NAME` | `MediaClicks` |
| `SEED_OWNER_EMAIL` | the owner's real address |
| `SEED_OWNER_NAME` | the owner's real name |
| `SEED_OWNER_PASSWORD` | a strong temporary password |
| `SEED_TIMEZONE` | `Asia/Dubai` |
| `RESEND_API_KEY` | optional — see step 10 |

`AUTH_URL` must be the deployed URL. Sign-in redirects break if it still says
`localhost:3000`.

The `SEED_*` values are read only by `npm run db:seed`, never at runtime.

### 7. Deploy, and check it boots

Deploy, open the URL, confirm the login page renders. Do not sign in yet —
there is still demo data behind it.

---

## Real data

Run these from your machine with `.env.local` pointing at the **production**
database. Change `DATABASE_URL` locally, run them, then change it back.

### 8. Remove the demo data

```powershell
npm run db:demo -- clear
```

Removes only what the demo script created — meetings tagged in
`description`, clients tagged in `notes`, people tagged in `avatar_url`. It
cannot touch a real row, which is why it is safe to run against production.

Confirm the app is empty: no clients, no meetings, and only the owner on the
Team page.

### 9. Create the real owner

```powershell
npm run db:seed
```

Idempotent: creates the org, the three system roles and their permissions,
and the owner account from the `SEED_*` values. Safe to re-run.

Sign in as the owner and change the password immediately — Profile → it was
typed into an environment variable, so treat it as temporary.

### 10. Client emails (optional)

Without `RESEND_API_KEY`, a client meeting still saves and the send failure
is recorded in the audit log. Nothing is lost; nothing is sent.

To turn it on: create a key at resend.com, verify the sending domain, and set
`RESEND_API_KEY` and `MAIL_FROM` in Vercel.

---

## The team

### 11. Add each member

As the owner: **Team → Add person**. Name, email, and an initial password of
at least 12 characters that you choose.

No invitation email is sent — the app has no invite flow. You hand each
person their password directly, and they change it in Profile.

Everyone is created as **Member**. Promote from the same screen:

- **Owner** — everything, including roles and permissions
- **Manager** — can edit and cancel anyone's meetings, invite people
- **Member** — their own meetings; can *ask* an owner to change someone
  else's rather than being refused (ADR 0008)

Give out Manager sparingly. A Member is not blocked from anything important;
their requests go to the meeting's owner as a chat message with Approve and
Deny on it.

### 12. What to hand over

For each person:

- the URL
- their email
- their initial password, and that they must change it in Profile
- their role

Send passwords over something that is not the same channel as the URL where
practical. They are single-use by intention.

---

### 13. Point a cron service at the worker

Reminders need minutes, not hours, and GitHub Actions cannot afford minutes
on a private repository. A one-minute-minimum bill per run means a `*/5`
schedule costs ~8,640 minutes a month against a 2,000 free allowance — it
would have stopped part-way through every month, silently.

So the workflow in `.github/workflows/notifications.yml` now runs **hourly**
as a safety net, and the real schedule lives outside GitHub.

Any free HTTP cron works — cron-job.org, EasyCron, Cloudflare Workers Cron.
Configure one job:

| Field | Value |
|---|---|
| URL | `https://<your-domain>/api/cron/notifications` |
| Method | `POST` |
| Schedule | every 5 minutes |
| Header | `Authorization: Bearer <CRON_SECRET>` |

Both schedules running together is fine and intended. The unique index on
`(user_id, type, meeting_id, scheduled_for)` is declared `NULLS NOT
DISTINCT`, so a repeated tick inserts nothing — the idempotency is in the
database, not in the caller.

**Check it took.** Home shows a red "Reminders" row in *Needs you* when
notifications are queued past their time and undelivered:

> 3 reminders queued but not sent — the worker has not run for 2 hours.

That row is derived from the rows the worker would have drained, so it
cannot be fooled by a heartbeat that still ticks while delivery is broken.
If it never appears, the worker is running.

### 14. Turn on backups

`.github/workflows/backup.yml` dumps the database nightly at 02:00 UTC
(06:00 Dubai) and keeps 90 days of artifacts. It needs one secret:

Repository → Settings → Secrets and variables → Actions → New secret:

| Name | Value |
|---|---|
| `DATABASE_URL` | the **production** connection string |

Run it once by hand — Actions → Backup → Run workflow — and download the
artifact to confirm it is a real dump and not an empty file with a header.
The job already fails on a dump under 1 KB or one missing any of `users`,
`meetings`, `clients`, `audit_log`, but look at it once yourself.

**Why this exists:** no free database tier gives you a downloadable backup.
Supabase Free has none at all; Neon Free keeps six hours of history, which
covers a mistake but not a deleted project. This is the copy you own.

**Restoring** into a fresh database:

```bash
gzip -dc mediaclicks-2026-08-04.sql.gz | psql "$NEW_DATABASE_URL"
```

The dump is `--no-owner --no-privileges`, so it restores under whatever role
the new database uses. Run `npm run db:migrate` first if the target is
empty — the RLS lockdown lives in the migrations, not the dump.

---

## After go-live

**Pause the old Singapore Supabase project** (Settings → General) rather than
deleting it, for a week. Then delete it.

**The notification worker** needs `CRON_SECRET` to match between Vercel, the
external cron service and the GitHub Actions workflow, or reminders 404
silently on a schedule nobody watches. See step 13.

**Watch the logs for the first week.** Every unexpected failure now names
itself — `[meeting action] unexpected failure:` and similar — in Vercel's
runtime logs. That was added after a swallowed error hid a broken query for
days; the logs are only useful if somebody reads them.
