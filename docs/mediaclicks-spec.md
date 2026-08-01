# MediaClicks Ops Platform — Build Specification

> Paste this as the founding spec for the project. It is written to be handed to a coding agent or used as your own reference doc. Build it phase by phase; do not attempt to generate the whole thing in one shot.

---

## 0. Context

Internal operations platform for **MediaClicks**, a social media marketing agency. Replaces the team's scattered use of calendars, WhatsApp, and manual meeting notes with one system.

Primary users: agency owner, account managers, media buyers, designers. Roughly 5–25 people. Desktop-first web app; mobile is notification + read-only surface.

**Non-goal:** this is not a CRM, project manager, or invoicing tool. Scope is scheduling, meeting logistics, and meeting intelligence.

---

## 1. Tech Stack (fixed — do not substitute)

**Web app + API**
- Next.js 15 (App Router), TypeScript strict mode
- PostgreSQL via Supabase or Neon
- Drizzle ORM (typed schema, migrations checked into repo)
- Auth.js (NextAuth) with credentials + Google OAuth provider
- Tailwind + shadcn/ui
- Zod for all input validation at the API boundary

**AI service (separate deployable) — decision pending, see §1.1**
- Python 3.12, FastAPI
- Handles: the assistant agent (and transcript summarisation if/when that ships)
- Communicates with the Next.js app over authenticated HTTP (shared secret in header) — not a shared database connection
- Pydantic for schemas, pytest for tests

**Infrastructure**
- Background jobs: BullMQ (Redis) or Inngest for scheduled reminders and daily digests
- Deployment: Vercel (web) + Railway/Fly.io (Python service)
- CI: GitHub Actions running typecheck, lint, tests on every PR

---

### 1.1 Open architectural decision: does the Python service survive?

Transcription and summarisation have been deferred by the client (see §4.5). That was the workload that genuinely justified a separate Python deployable — long-running, bursty, ML-ecosystem-dependent. What remains is the assistant agent, which is a handful of tool-calling loops and runs perfectly well in a Next.js route handler.

Two honest options:

**Option A — single TypeScript service.** Build everything in Next.js. Simpler deploy, one language, no cross-service auth to maintain. If transcription ships later, split the Python service out *then*, when it has a real reason to exist.

**Option B — keep the Python service now.** Justified only if you (a) genuinely intend to ship transcription in this internship, or (b) want the agent layer in Python for the tooling ecosystem and are prepared to defend that specifically.

**Recommendation: Option A.** A cleanly built monolith with a documented reason for *not* splitting is a stronger interview answer than a two-service architecture where one service does almost nothing. "I removed a service when its justification disappeared" is a better story than "I used microservices." If you want Python on the CV, get it there through a real workload, not a token one.

Whichever you pick, write the reasoning into the README. The reasoning is the portfolio asset, not the diagram.

---

---

## 2. Data Model

Design these tables first. Everything else follows from them.

```
organisations
  id, name, created_at

users
  id, org_id, email, password_hash, full_name, avatar_url,
  phone_e164 (nullable), timezone, created_at, last_login_at

roles
  id, org_id, name, is_system_role
  -- system roles seeded: Owner, Manager, Member

permissions
  id, key
  -- see permission list below

role_permissions
  role_id, permission_id

user_roles
  user_id, role_id

clients
  id, org_id, company_name, contact_name, email (nullable),
  phone_e164 (nullable), preferred_channel enum('email','whatsapp'), notes

meetings
  id, org_id, title, description, starts_at (timestamptz), ends_at,
  type enum('client','internal'), client_id (nullable),
  created_by_user_id, conferencing_provider enum('google_meet','zoom','whatsapp','none'),
  conference_url (nullable), conference_external_id (nullable),
  recording_consent_given boolean, status enum('scheduled','cancelled','completed')

meeting_attendees
  meeting_id, user_id, response enum('pending','accepted','declined')

meeting_transcripts
  id, meeting_id, raw_text, provider, language, duration_seconds, created_at

meeting_summaries
  id, meeting_id, tl_dr, key_points jsonb, decisions jsonb,
  action_items jsonb, client_requests jsonb, model_used, created_at

notifications
  id, user_id, type enum('daily_digest','meeting_reminder','meeting_changed',
  'assigned_to_meeting'), payload jsonb, channel enum('web_push','email'),
  scheduled_for, sent_at, read_at

audit_log
  id, org_id, actor_user_id, action, entity_type, entity_id,
  before jsonb, after jsonb, created_at
```

**Key constraint:** all queries must be scoped by `org_id`. Enforce with a query helper that takes the session's org and refuses to build a query without it.

---

## 3. Roles & Permissions

Permission-based, not role-based, in the code. Roles are just named bundles of permissions so the Owner can create custom ones from the UI.

Permission keys:

```
meeting.create.own
meeting.create.any          -- schedule on someone else's behalf
meeting.edit.own
meeting.edit.any
meeting.delete.own
meeting.delete.any
meeting.view.own
meeting.view.all            -- see the whole team calendar
transcript.view.own
transcript.view.all
client.manage
user.invite
user.manage
role.manage
```

Seeded defaults:
- **Owner** — all permissions, cannot be deleted, at least one must always exist
- **Manager** — everything except `role.manage`, `user.manage`
- **Member** — `*.own` permissions plus `meeting.view.all`

**Implementation requirement:** a single `can(user, permission, resource?)` function used by both the API layer and the UI. Server-side check is authoritative; UI only hides buttons. Every mutation endpoint calls it before touching the database. Write unit tests for the permission matrix — this is the part of the codebase most worth showing off.

---

## 4. Feature Specifications

### 4.1 Scheduling

- Calendar views: day, week, month. Week is the default.
- Toggle between "my schedule" and "team schedule" (team view gated on `meeting.view.all`).
- Creating a meeting: title, description, start/end, type (client vs internal), attendee multi-select, conferencing provider, and — if client type — client selection plus delivery channel.
- Adding a user as an attendee places the meeting on their calendar and triggers an `assigned_to_meeting` notification.
- Conflict detection: warn (do not block) when an attendee already has an overlapping meeting.
- All times stored UTC, rendered in each user's timezone.
- Editing or cancelling a meeting notifies every attendee.

### 4.1.1 Create Meeting Flow

A single **`+` button** in the calendar header (and keyboard shortcut `n`) opens a modal. Fields reveal progressively — later options depend on earlier answers, so the form never shows a field that doesn't apply yet.

**Step 1 — Meeting type** (dropdown, required, nothing else renders until chosen)
- `Team meeting` — internal only
- `Client meeting`

**Step 2a — if Team meeting**
- **Platform** (dropdown): `Google Meet` · `Zoom` · `WhatsApp` · `No platform`
- Choosing Meet or Zoom generates a link and emails all attendees, same as a client meeting.
- Choosing WhatsApp or No platform generates nothing. The meeting is a schedule entry with normal reminders. No link field appears at all.

**Step 2b — if Client meeting**
- **Client** (searchable dropdown of existing clients, plus an inline "add new client" option so the flow isn't blocked)
- **Platform** (dropdown): `Google Meet` · `Zoom` · `WhatsApp`
  - Preselect based on the client's `region` (domestic → Meet, international → Zoom). Always overridable.
  - Meet/Zoom → link auto-created for the chosen time, emailed to all attendees + the client
  - WhatsApp → nothing generated, schedule entry and reminders only

**Step 3 — Common fields** (all types)
- Title (required), description (optional)
- Date, start time, end time — duration presets of 30m / 1h / custom
- **Attendees**: multi-select of team members. Creator is included by default and can be removed. Requires `meeting.create.any` to add anyone other than yourself.
- Live conflict indicator next to each selected attendee if they're already busy at that time. Warns, doesn't block.

**Step 4 — Confirm**
Before saving, show a one-line summary of what will happen: *"Zoom link will be created and emailed to 4 people."* or *"No link — WhatsApp meeting, reminders only."* This kills the most likely user error, which is someone expecting a link and not getting one.

**Implementation notes**
- Validate the whole thing with a single discriminated-union Zod schema keyed on meeting type. A team meeting has no `client_id`; a client meeting requires one. The type system should make an invalid combination unrepresentable rather than relying on runtime `if` checks.
- The modal is one component with conditional sections, not a multi-page wizard. Four steps is not enough to justify pagination.
- Same modal handles editing, prefilled. Changing the platform on an existing meeting revokes the old link and issues a new one.

---

### 4.1.2 Calendar Filters

Filter bar above the calendar, state persisted per user:
- **Type**: All / Team / Client
- **Platform**: All / Google Meet / Zoom / WhatsApp / None
- **Attendee**: All / just me / specific team member (member filter requires `meeting.view.all`)
- **Client**: filter to one client's meetings
- Free-text search across meeting titles

Colour-code events on the calendar by platform so the grid is scannable at a glance — one look should tell you which calls have links and which don't.

**Clicking any event opens a detail panel** showing time, attendees and their responses, client, description, and — for Meet/Zoom — the join link as a prominent copy/open button. This is the primary way people get to their links: click the meeting in the schedule bar, click join. No hunting through email.

### 4.2 Conferencing Links

The person creating the meeting picks one of three options. This is an explicit choice at creation time, not an automatic default.

| Choice | Link generated? | What happens |
|---|---|---|
| **Google Meet** | Yes | Link created via API, emailed to all attendees + client |
| **Zoom** | Yes | Link created via API, emailed to all attendees + client |
| **WhatsApp** | No | Calendar entry + reminders only. Call happens in WhatsApp as normal. |

**Suggested default (overridable):** domestic client → Google Meet, international client → Zoom. Driven by the `region` field on `clients`. Purely a preselect — the user can always change it, and WhatsApp is always available.

**Google Meet:** created via Google Calendar API `events.insert` with `conferenceData.createRequest`. Requires per-user Google OAuth (calendar scope). Store refresh tokens encrypted.

**Zoom:** Zoom Server-to-Server OAuth app, one org-level integration, `POST /users/me/meetings`.

**WhatsApp:** no integration, no API call, no link, nothing generated. The meeting exists purely as a calendar entry and feeds the normal notification pipeline (daily digest + T-30 reminder). The detail page shows the client's stored phone number as plain text so the team knows who to call — no deep link, no join button. The absence of a link should read as intentional, not broken.

**Shared requirements:**
- Build all three behind one `ConferenceProvider` interface (`create`, `update`, `cancel`). WhatsApp is a no-op implementation that returns `null` for the URL. The calling code never branches on provider — this is what keeps the meeting-creation flow clean.
- Store the returned join URL and external ID so the link can be updated or revoked if the meeting is rescheduled or cancelled.
- If Meet or Zoom fails, the meeting **still saves** with `conference_url: null` and a retry action in the UI. Never silently drop it.
- Internal meetings may use any of the three, or `none`.

### 4.3 Client Invitations

### 4.3 Meeting Invitation Emails

**Everyone on the meeting gets the email — internal attendees and the client alike.** Previously the spec sent invitations only to clients; that is now wrong. One email, one template, all recipients.

Sent when a meeting is created with provider Meet or Zoom:

- **To:** every user in `meeting_attendees` (at their account email) + the client's email if it's a client meeting
- **Contains:** meeting title, date and time rendered in each recipient's timezone, duration, attendee list, the join link as a large obvious button, and the description if there is one
- **Plus a short reminder line** — one sentence, e.g. *"You'll get a reminder 30 minutes before this call."* Keep it to a single line; this is a nudge, not a second section.
- Attach a `.ics` calendar file so it drops into whatever calendar the recipient actually uses. Cheap to generate, disproportionately useful.

**Re-sent on change:** if the meeting is rescheduled or the link is regenerated, send an update email with the old time struck through and the new time highlighted. If cancelled, send a cancellation.

**WhatsApp-type meetings send no email by default.** There's no link to distribute. Offer it as an optional checkbox on the create form for the rare case where someone wants a written record — off by default.

**Provider:** Resend or Postmark. Handle bounces and log delivery status against the meeting so the creator can see whether it actually landed.

---

### 4.3.1 A note on the WhatsApp Business API

The earlier version of this spec put Meta business verification on the critical path. **With WhatsApp as a meeting type rather than a delivery channel, that dependency disappears entirely from v1.** No Cloud API, no template approval, no business verification, no waiting on Meta.

This is a significant de-risking — it removes the one part of the project whose timeline you did not control. Do not add it back unless Miniz specifically asks for client invitations to be *delivered* over WhatsApp, which is a different requirement from meetings being *held* over WhatsApp. **Confirm which he meant before assuming.** If he does want delivery over WhatsApp, restore §4.3 from git history and start the verification paperwork immediately.

### 4.4 Notifications

Two triggers:
1. **Daily digest** — sent each morning at a per-user configurable time (default 08:00 local). Lists that day's meetings with times, attendees, and links. Skip if the user has no meetings.
2. **T-30 reminder** — 30 minutes before each meeting. Configurable per user.

Delivery:
- **Web Push** via the Push API + Service Worker. The app must be an installable PWA so team members add it to their phone home screen and receive push there. This is the whole mobile story — no native app.
- Email fallback for users who haven't granted push permission.

Implementation: a scheduled worker enqueues notification rows; a separate sender worker drains them. Enqueue idempotently (unique index on `user_id + type + meeting_id + scheduled_for`) so a worker restart doesn't double-send. Cancel pending notifications when a meeting is cancelled or rescheduled.

### 4.5 Meeting Intelligence (Transcripts & Summaries) — DEFERRED

**Status: out of scope for v1.** Deferred by the owner as too large for the initial build; planned as a later update. The section below is retained as the design for when it returns — do not build it now, but do not design it out either.

**What to preserve in v1 so this is cheap to add later:**
- Keep the `meeting_transcripts` and `meeting_summaries` tables in the schema, unused. Empty tables cost nothing; retrofitting them into a live schema is painful.
- Keep `recording_consent_given` on `meetings`.
- Do not build the UI, the ingestion pipeline, or the recording bot integration.

**When it returns — how audio is captured, pick one:**

- **Option A (recommended): Recall.ai bot.** A bot joins the Meet/Zoom call as a participant, records, and posts a transcript to your webhook. Works across providers, one integration.
- **Option B: native cloud transcripts.** Zoom cloud recording transcripts via API; Google Meet transcripts via the Meet REST API (Workspace tier required). Cheaper, but two integrations and gaps in coverage.

**Consent is mandatory, not optional.** UK and EU rules mean all participants must be informed a call is being recorded. Requirements:
- A `recording_consent_given` flag on the meeting, defaulting to false
- Explicit toggle at creation time with clear copy
- The bot's display name must state it is recording (e.g. "MediaClicks Notetaker")
- Consent line included in the client's invitation email
- Transcript ingestion rejected if the flag is false

**Summarisation pipeline (Python service):**

1. Webhook receives transcript → store raw → enqueue summarisation job
2. Chunk long transcripts, map-reduce for anything over the model's comfortable context
3. Structured extraction into a Pydantic schema:
   ```python
   class MeetingSummary(BaseModel):
       tl_dr: str                      # 2-3 sentences
       key_points: list[str]
       decisions: list[Decision]       # what was decided, by whom
       action_items: list[ActionItem]  # task, owner, due date if stated
       client_requests: list[str]      # explicit asks from the client
       sentiment: Literal["positive","neutral","concerned"]
   ```
4. Store and notify attendees that the summary is ready

**UI:** a meeting detail page with the summary above the fold and the full transcript collapsed below, plus keyword search across all transcripts the user has permission to view.

### 4.6 Assistant ("Jarvis")

Scope this tightly. A vague chatbot is a liability; a narrow agent with real tools is a portfolio piece.

Implement as a **tool-calling agent** in the Python service with a fixed toolset:

```
reschedule_meeting(meeting_id, new_start, new_end)
cancel_meeting(meeting_id, reason)
find_free_slot(user_ids[], duration_minutes, within_days)
list_my_meetings(date_range)
search_transcripts(query)
notify_user(user_id, message)
reassign_meeting(meeting_id, from_user_id, to_user_id)
```

Hard rules:
- Every tool call passes through the **same permission layer** as the REST API. The agent cannot do anything the user couldn't do by clicking. This is the single most important design decision here.
- Any destructive or externally-visible action (cancelling, notifying, reassigning) renders a confirmation card in the UI that the user must approve before it executes. No silent side effects.
- Every agent action written to `audit_log` with `actor_user_id` set to the human, and a flag marking it agent-initiated.
- Text input first. Voice via the Web Speech API is a later polish item, not v1.

---

## 5. UI Direction

Professional agency software, not a hackathon demo. Reference points: Linear, Cron/Notion Calendar, Height.

- Dense but not cramped; generous whitespace inside cards, tight line-height in lists
- One accent colour, used sparingly. Neutral greys carry the interface.
- Real typographic hierarchy — Inter or Geist, weight-based rather than size-based distinction
- Keyboard shortcuts for the calendar (`n` new meeting, `t` today, arrow keys to navigate)
- Skeleton loaders, optimistic updates on meeting creation, real empty states with a call to action
- Dark mode
- Everything from `shadcn/ui` so it stays consistent and accessible by default

---

## 6. Build Order

**Phase 1 — Foundation**
Auth, org/user model, roles and permissions with full test coverage, user invitation flow, basic dashboard shell.

**Phase 2 — Scheduling**
Calendar views, meeting CRUD, attendees, conflict detection, timezone handling, audit log.

**Phase 3 — Notifications**
Job queue, PWA + web push, daily digest, T-30 reminders, per-user preferences, email fallback.

**Phase 4 — Conferencing & Clients**
Client records with `region`, `ConferenceProvider` interface with all three implementations, Google OAuth + Meet creation, Zoom integration, invitation emails with `.ics` attachments.

**Phase 5 — Assistant**
Tool-calling agent, permission-gated tools, confirmation cards, chat UI.

**Phase 6 — Polish**
Voice input, delivery-status reporting, analytics, performance pass.

**Future update — Meeting Intelligence**
Recording bot, consent flow, transcript storage, summarisation pipeline, transcript search. Schema stubs already in place from Phase 1.

**Only if Miniz confirms he wants it — WhatsApp delivery**
Cloud API, Meta business verification, template approval. Not in scope unless explicitly requested; see §4.3.1.

Each phase ships working and deployed before the next begins.

---

## 7. Engineering Standards

These are what make the project defensible in an interview, not the feature list.

- **Tests:** permission matrix, notification scheduling idempotency, timezone conversion edge cases (DST boundaries), and the summarisation schema. Aim for meaningful coverage of the logic, not a coverage percentage.
- **Error handling:** typed error results at the API boundary, no thrown strings. External API calls wrapped with retry + exponential backoff.
- **Secrets:** never in the repo. `.env.example` committed, real values in the deployment platform. OAuth refresh tokens encrypted at rest.
- **Migrations:** every schema change is a checked-in migration file. No manual database edits.
- **README:** architecture diagram, the reasoning behind the two-service split, local setup instructions, and a short section on the trade-offs you rejected. Write this as you go, not at the end.
- **Commits:** conventional commits, small and focused. Your commit history is part of the portfolio.

---

## 8. Open Questions

**Resolved (confirmed with Miniz):**
- ~~Meet or Zoom?~~ → Both, plus WhatsApp as a third option. User picks per meeting.
- ~~Transcription approach?~~ → Deferred to a future update.
- ~~WhatsApp Business API?~~ → Not needed in v1. See §4.3.1.

**Still blocking — ask Miniz this week:**
- **The important one:** when he said client comms happen on WhatsApp, did he mean calls are *held* there (assumed here, no API needed), or that meeting invites should be *sent* there (needs Meta verification, weeks of lead time)? These are very different projects. Get a straight answer before Phase 4.
- Does the agency have a **Zoom paid plan**? Server-to-Server OAuth requires it, and the free tier caps group calls at 40 minutes.
- Is the team on **Google Workspace** or personal Gmail? Affects OAuth verification requirements.
- **Who is the Owner account** on day one, and does Miniz create every user himself or is there an invite flow?

**Your own decision, not the client's:**
- Option A or Option B from §1.1. Decide before writing the first line of code.
- LLM provider and monthly spend ceiling for the assistant.
