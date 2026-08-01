import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * Builds `col IN ('a', 'b', ...)` for a CHECK constraint.
 *
 * Drizzle's `text(col, { enum: [...] })` gives the TypeScript union but emits
 * no database constraint — without this, the type safety would stop at the
 * compile boundary and any raw SQL or bad migration could write a junk value.
 * Generating the CHECK from the same const array closes that gap.
 *
 * `sql.raw` is required because DDL cannot take bind parameters. The values
 * are compile-time constants from our own arrays, never user input, but the
 * quotes are escaped anyway rather than relying on that staying true.
 */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')
  return sql`${column} IN (${sql.raw(list)})`
}
