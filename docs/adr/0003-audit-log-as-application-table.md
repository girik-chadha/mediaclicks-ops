# ADR 0003 — The audit log is written by the application, not a trigger

**Status:** accepted
**Date:** 2026-08-01

## Context

`audit_log` records who changed what, with `before` and `after` as `jsonb`
(§2). There are two standard ways to populate it: database triggers on each
audited table, or explicit writes from the application inside the same
transaction as the change.

Triggers are tempting because they are unforgettable. Nothing can bypass them —
not a migration, not a `psql` session, not a second service.

## Decision

The application writes audit rows, inside the same transaction as the mutation
they describe.

## Why not triggers

**A trigger cannot know the actor.** Postgres knows the database role, which
is the connection-pool user, identical for every request. Recovering
`actor_user_id` means smuggling it in via a session variable
(`SET LOCAL app.user_id`) before every statement — which is application code
that can be forgotten, so the trigger's one advantage is already gone. It just
fails silently instead of visibly.

**A trigger cannot know intent.** §4.6 requires `agent_initiated` on every
agent action, with the human as actor. At the row level, an assistant
rescheduling a meeting and a user dragging it are the same UPDATE. The
distinction exists only above the database.

**`action` is not derivable from the diff.** "Cancelled a meeting" and
"changed status" are the same column write. The audit log is read by humans
asking what happened; a column-level diff answers a different, less useful
question.

**Business-level events have no row.** "Invitation email bounced", "Zoom link
creation failed, meeting saved without one" (§4.2) are audit-worthy and
correspond to no UPDATE at all.

## Consequences

Positive:

- One code path for both, so `action`, `actor_user_id`, `actor_email` and
  `agent_initiated` are always populated.
- The audit write is transactional with the change: they commit together or
  not at all. There is no window where one exists without the other.
- Testable without a database — the audit payload is a value returned by a
  pure function.

Negative:

- **It can be forgotten.** This is the real cost and it is not waved away. The
  mitigation is structural: mutations go through a single helper that takes
  the audit payload as a required argument, so omitting it is a type error
  rather than an oversight. Direct `db.update()` calls on audited tables are
  the thing to watch for in review.
- Out-of-band changes (a migration, a manual fix) are not recorded. Accepted:
  those are rare, and migrations are themselves checked into the repo, which
  is its own audit trail.

## Two schema details this drives

**`actor_user_id` is `ON DELETE SET NULL`, not `CASCADE`.** Cascading would
mean deleting a user erases the evidence of what they did — the precise thing
an audit log exists to prevent.

**`actor_email` is denormalised at write time.** Once `actor_user_id` goes
null, the row would otherwise read "someone did this", which is not an audit
record. Audit rows must be self-contained because they outlive the rows they
reference.

**`before`/`after` are `jsonb`, not `json`.** The diff is queried — which
fields changed, what a value was on a given date — and only `jsonb` supports
the operators and indexes that makes possible.
