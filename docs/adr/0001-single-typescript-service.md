# ADR 0001 — One TypeScript service, not two

**Status:** accepted
**Date:** 2026-08-01
**Resolves:** spec §1.1, which requires this decision before the first line of code.

## Context

The spec's original stack had a Next.js app plus a separate Python/FastAPI
service. That service existed to carry two workloads: transcript
summarisation, and the assistant agent.

Transcription and summarisation were then deferred by the client (§4.5). That
removed the workload which actually justified a second deployable — it is
long-running, bursty, and depends on the Python ML ecosystem. None of those
properties describe what is left.

What remains is the assistant (§4.6): seven tools, a tool-calling loop, and a
confirmation step. That runs in a route handler.

## Decision

Build Phase 1–6 as a single Next.js service. No Python service.

## Consequences

Positive:

- One language, one deploy target, one dependency graph, one CI pipeline.
- No cross-service authentication to build or rotate. The spec's shared-secret
  header (§1) is a thing that can leak; not having it is strictly safer than
  having it and getting it right.
- The assistant's tools call `can()` **in process**. §4.6's hard rule — the
  agent cannot do anything the user could not do by clicking — becomes a
  direct function call rather than an RPC that has to faithfully reproduce the
  caller's permission context across a network boundary. That boundary is
  exactly where an authorization bug would hide.

Negative:

- If transcription returns, summarisation lands in a service sized for
  request/response work. Mitigated below.
- No Python in the codebase. This is a real CV cost and is accepted knowingly:
  a service that exists to have been built is visible as such.

## The condition that reverses this

Split the Python service out when §4.5 ships — specifically when there is a
webhook receiving transcripts and a map-reduce summarisation job. At that
point the second service has a workload that a Next.js route handler is a poor
fit for, and the split argues for itself.

The schema is already prepared for that day: `meeting_transcripts` and
`meeting_summaries` exist from Phase 1 (§4.5 explicitly asks for this), so the
retrofit is additive rather than a migration against live data.

## Rejected alternative

**Keep the Python service now, sized for the assistant alone.** Rejected
because it buys a two-service architecture diagram at the cost of a real
network boundary through the authorization path, in exchange for a workload
that does not need it. "I removed a service when its justification
disappeared" is a defensible engineering position; "I used microservices" is
not one.
