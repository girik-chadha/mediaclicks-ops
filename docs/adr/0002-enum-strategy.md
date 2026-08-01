# ADR 0002 — Enumerated values as text + CHECK, not Postgres enums

**Status:** accepted
**Date:** 2026-08-01
**Applies to:** all 8 enumerated columns.

## Context

The schema has eight closed value sets: meeting type and status, attendee
response, conferencing provider, preferred channel, client region,
notification type and channel.

The obvious choice is `CREATE TYPE ... AS ENUM`. It has the best storage (4
bytes) and gives the database a real type.

It also has migration properties that are easy to discover too late:

- **A value cannot be removed.** Ever. Correcting a mistake means creating a
  new type, rewriting every column that uses it, and dropping the old one.
- **`ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that
  adds it.** Drizzle runs each migration in a transaction, so adding a value
  and backfilling data with it is necessarily two migrations.
- Reordering and renaming are similarly awkward.

These are not hypothetical here. `conferencing_provider` **already changed
once during specification**, from two values to four, before a single row
existed.

## Decision

Every enumerated column is `text` with a `CHECK (col IN (...))` constraint.

The values are declared once in `src/server/db/schema/enums.ts` as a `const`
array and consumed twice:

- Drizzle's `text(col, { enum: VALUES })` produces the TypeScript union — the
  **identical** type `pgEnum` would have produced. Nothing is lost at the
  compile boundary.
- `oneOf(col, VALUES)` generates the CHECK constraint from the same array.

One source, so the type and the constraint cannot drift.

## Why the constraint is not optional

`text(col, { enum })` is a TypeScript-only refinement. Drizzle emits **no**
database constraint for it. Relying on it alone would mean type safety that
stops at the application boundary — a migration, a seed, a `psql` session, or
a future service could write anything. Generating the CHECK is what makes the
guarantee real rather than advisory.

## Consequences

- Adding or removing a value is one transactional
  `DROP CONSTRAINT ... ADD CONSTRAINT`. Symmetrical, and reversible.
- Storage cost: text rather than 4 bytes. At 5–25 users and a few thousand
  meetings a year, immeasurable.
- No shared type across tables. Irrelevant here — none of the eight sets is
  used by more than one column, so there is nothing to share.

## Rejected alternatives

**Native `pgEnum`.** Rejected on the migration properties above.

**Hybrid — native enums for the genuinely closed sets** (`meeting_status`,
`attendee_response`, `meeting_type`), text + CHECK for the rest. Rejected for
two reasons: it puts two patterns in one schema that a reader has to learn and
choose between, and "genuinely closed" is a prediction. `meeting_status` could
plausibly gain `no_show` or `rescheduled`, at which point the classification
was wrong and the migration is the painful one.

**Lookup tables with foreign keys.** The right answer when a value carries
metadata. Here the only candidate is `conferencing_provider`, whose metadata
(display name, whether it generates a link) belongs in the TypeScript
`ConferenceProvider` registry described in §4.2 — that is where the behaviour
lives, and splitting the data away from it would help nobody. Rejected as a
join on the calendar's hottest query in exchange for nothing.
