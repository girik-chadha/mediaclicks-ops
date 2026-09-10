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

### 2. Meeting edit and cancel — verified 2026-09-09

They were broken for the whole of development by a query asking Postgres for
every meeting up to the year 275760 (`src/server/meetings/queries.ts`). The
fix shipped typechecked and tested but unconfirmed against a live database —
now confirmed: create, edit, and cancel all checked against the restored
production database on Vercel, not just development. If this ever regresses,
the terminal names the cause rather than failing silently.

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

**Vercel's copy of every one of these is independent of everything else** —
your machine, Supabase, GitHub Actions. Rotating the database password, or
even the whole database going through a pause-and-restore, changes nothing
here until someone edits it in this exact screen and redeploys. Missed once
during this project's own go-live: `DATABASE_URL` sat on the connection
string from the original import for over a month while the database was
rotated and restored underneath it. The symptom was not a connection error —
Auth.js caught the failed query inside `authorize()` and folded it into the
same generic "that email and password don't match" message a real wrong
password produces (`src/app/(auth)/login/actions.ts`), which reads exactly
like the credentials are wrong when they never were. If sign-in ever fails
mysteriously again after any secret rotation, check this page before
doubting the password.

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

**Nobody is ever handed a password.** Accounts are created without one, and
each person sets their own by going to the sign-in page, clicking **Forgot
password**, and following the emailed link. That is the whole onboarding
flow, and it is the same flow they use if they ever forget it.

**Which means email has to reach them first.** The Resend sandbox address
(`onboarding@resend.dev`) delivers only to the mailbox that owns the Resend
account — everyone else's link is silently dropped and their account is
unreachable. Verify a real sending domain in Resend and set `MAIL_FROM` to it
*before* this step, or you will be onboarding exactly one person.

Two ways to add people; both create the account the same way.

**The whole team at once**, from `team.txt` (email, role, first name, last
name per line):

```powershell
node --import tsx scripts/add-team.ts team.txt            # shows the plan
node --import tsx scripts/add-team.ts team.txt --apply    # writes it
```

Safe to re-run: an address that already exists has its name and role brought
up to date and its password left untouched.

**One person**, as an owner: **Team → Add person**. First name, last name,
email. Owners only — a Manager cannot add people, because an account created
here can be claimed by whoever controls that mailbox.

Everyone is created as **Member**. Promote from the same screen:

- **Owner** — everything, including roles, permissions, and adding people
- **Manager** — can edit and cancel anyone's meetings
- **Member** — their own meetings; can *ask* an owner to change someone
  else's rather than being refused (ADR 0008)

Give out Manager sparingly. A Member is not blocked from anything important;
their requests go to the meeting's owner as a chat message with Approve and
Deny on it.

### 11½. The two owners, and the first thing each must do

Both owner accounts were seeded with a **known temporary password**, at
the outgoing owner's request, so the handover could happen without an
email round trip. That is a deliberate exception to the rule above, and
it has a shelf life of one sign-in.

**On first sign-in, each owner:**

1. **Profile → Password → Change password.** Until this happens, the
   person who ran the seed knows the other owner's password, and so does
   the chat transcript the seed was run from. An owner account holds every
   permission.
2. **Home → "Sign-in security" → Turn it on** (or Profile → Sign-in
   security). A code is emailed on every sign-in from then on. Owners
   should not skip this; theirs are the accounts worth stealing.

The thirteen members were created with no password at all and are
unaffected — they set their own from the emailed link, as §11 describes.

**Also outstanding at handover** — `AUTH_SECRET` in Vercel has been
exposed during development and should be rotated one more time by the
incoming owner: `npx auth secret` → paste into Vercel → redeploy. It signs
every session cookie, so whoever holds it can mint a session for anyone.

### 12. What to hand over

For each person:

- the URL
- their email
- their initial password, and that they must change it in Profile
- their role

Send passwords over something that is not the same channel as the URL where
practical. They are single-use by intention.

---

### 13. The cron

Reminders need minutes, not hours. `vercel.json` already declares a native
Vercel cron hitting `/api/cron/notifications` every 5 minutes — nothing to
configure, it activates on deploy. **This requires the Pro plan**: Hobby
caps cron at once a day, and a schedule that would run more often fails at
deploy rather than silently falling back.

Vercel's own cron invokes over `GET` — there is no way to configure it for
any other method — which is why the route answers both `GET` and `POST`
identically.

`.github/workflows/notifications.yml` still runs **hourly** underneath this,
on a separate provider, as a safety net. Not redundant: Vercel's own docs
call cron delivery "best effort" and can silently skip a tick, and GitHub
Actions cannot afford minutes on a private repo (~8,640/month at `*/5`
against a 2,000 free allowance), so it stays hourly rather than becoming the
primary schedule.

Both schedules running together is fine and intended. The unique index on
`(user_id, type, meeting_id, scheduled_for)` is declared `NULLS NOT
DISTINCT`, so a repeated tick inserts nothing — the idempotency is in the
database, not in the caller.

**No Pro, no client with a card on file yet?** Point any free HTTP cron
(cron-job.org, EasyCron, Cloudflare Workers Cron) at the same URL instead —
`POST` to `/api/cron/notifications` every 5 minutes, header
`Authorization: Bearer <CRON_SECRET>` — and remove the `crons` block from
`vercel.json` so Vercel doesn't also fire it on Hobby's once-a-day cap.

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
