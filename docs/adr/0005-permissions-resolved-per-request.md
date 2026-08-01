# ADR 0005 — Permissions are read per request, not carried in the session token

**Status:** accepted
**Date:** 2026-08-01

## Context

Sessions are JWTs (credentials sign-in has no database session to look up).
The token already carries `userId` and `orgId`. Carrying the user's flattened
permission set as well is free at read time and removes a query from every
request.

## Decision

The token carries identity only. `getActor()` resolves permissions from the
database on each request, wrapped in React's `cache()` so the several server
components and route handlers in one request share a single query.

## Why

**A JWT cannot be de-escalated.** It is a signed bearer assertion; the server
believes it until it expires. If permissions live in the token, then revoking
one — the Owner unticking a box in the permissions matrix (§6.5 of the design
brief) — does nothing until that user's token expires or they sign out. The
Owner would watch the UI say "revoked" while the user keeps editing. An
authorization control that does not take effect when used is worse than not
having it, because it is trusted.

The same argument covers deactivation (ADR 0004): `getActor()` re-checks
`deactivated_at` on every request, so removing someone's access is immediate
rather than eventual.

**The cost is one indexed query.** `user_roles` → `role_permissions` →
`permissions`, joined on primary keys, with `user_roles_user_idx` covering the
lookup. Tens of rows for a 5–25 person agency, cached per request.

**Tokens stay small.** Fourteen permission keys today, and §3 explicitly
allows the Owner to define custom roles — so the set is designed to grow. JWTs
travel in a cookie on every request, including static asset requests that pass
through middleware.

## Consequences

- Permission and role changes take effect on the user's next request.
- Every authenticated request makes one extra query. Accepted; measured
  against the alternative, this is the cheap side of the trade.
- `getActor()` returns `null` for a user deleted or deactivated since sign-in,
  so the JWT is never the final word on whether an account is live.

## Rejected alternative

**Permissions in the token, with a short expiry (5–15 minutes) to bound
staleness.** This trades a correctness property for a latency one and does not
actually reach correctness — it only shortens the window in which a revoked
permission still works. It also adds refresh-token machinery to avoid signing
people out mid-session, which is more moving parts than the query it was
meant to avoid.
