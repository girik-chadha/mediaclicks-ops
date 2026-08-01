# ADR 0004 — Tenant isolation, and what deletion actually does

**Status:** accepted
**Date:** 2026-08-01
**Implements:** spec §2's key constraint — all queries scoped by `org_id`.

## Where `org_id` lives, and where it deliberately does not

**First-class entities carry `org_id`:** `users`, `roles`, `clients`,
`meetings`, `notifications`, `meeting_transcripts`, `meeting_summaries`,
`audit_log`.

On the last three it is denormalised — their org is already reachable through
a parent. It is duplicated anyway because each has an independent query path
that must be scoped without the caller remembering a join:

- the notification sender drains across tenants and must filter or shard by org
- §4.5's transcript search runs across transcripts, not through meetings

A forgotten join is a silent cross-tenant read. A forgotten `org_id` filter is
caught by the scope helper. Those are not the same risk.

**Pure join tables do not carry `org_id`:** `role_permissions`, `user_roles`,
`meeting_attendees`. Their rows cannot exist without both parents (composite
primary key, both foreign-keyed), and every query path into them begins at an
already-scoped entity. Adding `org_id` would be a third copy of a fact already
guaranteed twice.

**`permissions` has no `org_id` at all.** Permission keys are global constants
shipped with the code — a key means something only because there is code
enforcing it. A per-tenant permission key would imply per-tenant code.

### Drift, and the escalation if it ever matters

Denormalised `org_id` can in principle disagree with its parent. It is set on
insert from the parent and never updated, and rows do not move between orgs.

If this ever became multi-tenant in earnest, the rigorous fix is composite
foreign keys — `meeting_transcripts(meeting_id, org_id)` referencing
`meetings(id, org_id)`, which needs a unique index on `meetings(id, org_id)`.
That makes drift structurally impossible. Not done now because it costs an
index per parent to defend against a write path that does not exist yet, and
Postgres row-level security would be the better answer at that scale anyway.

## Delete policy

Every foreign key states an `onDelete` deliberately. There is no default.

| Reference | Policy | Reasoning |
|---|---|---|
| `*.org_id → organisations` | `cascade` | Deleting the tenant removes the tenant's data. The one genuinely destructive operation, and it is not exposed in the UI. |
| `role_permissions.*`, `user_roles.*` | `cascade` | Join rows are meaningless without either parent. |
| `meeting_attendees.meeting_id` | `cascade` | Same. |
| `meeting_attendees.user_id` | `cascade` | Removing a person removes them from attendee lists; the meetings survive. |
| `meeting_transcripts.meeting_id`, `meeting_summaries.meeting_id` | `cascade` | Derived artefacts of a meeting. |
| `notifications.user_id` | `cascade` | Pending notifications for a departed user are noise. |
| `notifications.meeting_id` | `cascade` | §4.4 requires cancelling pending notifications when a meeting is cancelled; the constraint does it rather than the worker. |
| `meetings.client_id` | **`restrict`** | A client with meetings on record cannot be deleted. Archive instead — deleting the client would rewrite history. |
| `meetings.created_by_user_id` | **`restrict`** | A meeting must always have an author. |
| `audit_log.actor_user_id` | **`set null`** | The record must outlive the account. See ADR 0003. |
| `audit_log.org_id` | `cascade` | Tenant erasure must be complete, including its audit. Accepted knowingly. |

## Users are deactivated, never deleted

`meetings.created_by_user_id` is `RESTRICT`, so a user who has ever created a
meeting cannot be hard-deleted. That is not an oversight — it is the
constraint that forces the correct behaviour.

People leave agencies, so `users.deactivated_at` exists. Deactivation is the
supported path: the account stops authenticating, the person disappears from
attendee pickers, and every meeting, audit row and attendance record they
touched stays intact and attributable.

This also protects §3's invariant that at least one Owner must always exist —
enforced in the role mutation layer with a count check inside the
transaction, since no constraint can express it.

The alternative — cascade from users, and let deleting a person delete the
meetings they scheduled for everyone else — is not a trade-off, it is a bug
with a plan.
