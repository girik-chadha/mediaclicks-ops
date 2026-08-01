import 'server-only'
import { eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

/**
 * The org-scoping helper the spec's §2 key constraint asks for: "enforce with
 * a query helper that takes the session's org and refuses to build a query
 * without it."
 *
 * `OrgScoped` only matches tables that actually have an `orgId` column, so
 * `inOrg(meetingAttendees, actor)` is a compile error rather than a runtime
 * surprise — that table reaches its org through its parents (ADR 0004), and
 * the type system says so.
 */
export interface OrgScoped extends PgTable {
  orgId: PgColumn
}

export interface HasOrg {
  readonly orgId: string
}

/**
 * The org predicate for a table. Always the first condition in a `where`.
 *
 * Taking the actor rather than a bare string means a caller cannot invent an
 * org id; it has to come from a resolved session.
 */
export function inOrg(table: OrgScoped, actor: HasOrg): SQL {
  return eq(table.orgId, actor.orgId)
}
