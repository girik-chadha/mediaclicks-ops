# CLAUDE.md

Internal scheduling and meeting-operations platform for MediaClicks, a social
media marketing agency (5–25 people).

Authoritative documents, in precedence order:

1. [`docs/mediaclicks-spec.md`](docs/mediaclicks-spec.md) — product and technical spec
2. [`docs/mediaclicks-design-brief.md`](docs/mediaclicks-design-brief.md) — visual direction
3. [`docs/adr/`](docs/adr/) — decisions that deviate from the spec, with reasoning

Read the spec section before implementing anything it covers. Where this file
and the spec disagree, the spec wins and this file is stale — fix it.

---

## Phase discipline

Build order is spec §6. **Only build the current phase.** Phases ship working
and deployed before the next begins.

Currently: **Phase 1 (Foundation)**. Do not build the calendar, notifications,
conferencing, clients UI, chat, or the assistant.

Meeting intelligence (§4.5) is deferred indefinitely. Its tables
(`meeting_transcripts`, `meeting_summaries`) and the `recording_consent_given`
flag exist in the schema deliberately and must not be removed — retrofitting
them into a live schema is the expensive path.

---

## Non-negotiable rules

**Every query is scoped by `org_id`.** Use the query helper in
`src/server/scope.ts`; it refuses to build a query without an org. A query
that reaches a user-data table without an org filter is a tenant-isolation
bug, not a style issue.

**`can()` is authoritative on the server.** Every mutation calls
`requirePermission()` before touching the database. The UI only hides buttons —
hiding a control is presentation, never enforcement. The assistant's tools
(§4.6) go through the same layer: the agent can do nothing the user could not
do by clicking.

**Permissions, not roles.** No code branches on the name "Owner", "Manager" or
"Member". Those are seed rows. Logic reads permission keys only, so the owner
can define custom roles from the UI without a deploy.

**`--live` magenta is reserved for time-criticality.** Four states only: the
now-playhead, a meeting in progress, one starting within 30 minutes, one
overdue. It never fills a button or decorates. Magenta anywhere else is a bug.

**All timestamps are `timestamptz`, stored UTC, rendered per-user.** No
exceptions, no naked `timestamp`.

**Secrets never enter the repo.** `.env.example` is committed; real values live
in the deployment platform.

---

## Stack — pinned deliberately

Do not upgrade these without reading the reason first.

| Pin | Why |
|---|---|
| **Next 15** (not 16) | Spec §1 fixes it, and Auth.js v5 is still beta and tested against 15. Revisit in Phase 6. |
| **TypeScript 5.9** (not 6) | TS 6.0 added `TS2882`, which errors on side-effect imports of untyped modules. Next 15 never declares `*.css`, so `import './globals.css'` fails to compile. Do not "fix" this with a `css.d.ts` shim — it hides a version mismatch that also affects Drizzle and Auth.js types. |
| **`@types/node` 24** | Matches the actual Node runtime. |

`outputFileTracingRoot` is set in `next.config.ts` because Next otherwise
infers the wrong workspace root on this machine.

---

## Commands

```bash
npm run dev
npm run typecheck && npm run lint && npm test   # what CI runs
npm run db:generate    # write a migration from the schema
npm run db:migrate
npm run db:seed        # roles, permissions, day-one Owner
```

---

## Conventions

- **Conventional commits, one logical unit per commit.** Commit history is a
  portfolio artifact (§7) — do not squash unrelated work together.
- **An ADR per non-obvious choice**, in `docs/adr/`. The reasoning is the
  deliverable, not the diagram. If a decision would make a reviewer ask "why
  not the obvious thing?", it needs an ADR.
- **Every schema change is a checked-in migration.** No manual database edits.
- **Typed errors at the API boundary.** No thrown strings. External calls get
  retry with exponential backoff.
- **Zod validates at every API boundary.** Prefer discriminated unions that
  make invalid combinations unrepresentable over runtime `if` checks.
- **Server-only code lives under `src/server/`** and starts with
  `import 'server-only'`, so a client component importing it fails at build.

## Copy voice (§8)

Plain, active, specific, from the user's side of the screen. `Create meeting`,
not `Submit`. `Emma can't edit other people's meetings`, not `Insufficient
permissions`. `Starts in 12 minutes`, not `Upcoming`. Never `Oops`, never
`Something went wrong`, never an exclamation mark.
