import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

/**
 * The lock on the public schema (ADR 0009).
 *
 * Supabase serves every table in `public` over a REST API keyed by the
 * project's anon key, which is meant to be published. A table added later
 * without row-level security is not a style problem — it is that table's
 * entire contents, readable and deletable by anyone with a URL.
 *
 * So this asserts the property rather than the migration: every table the
 * migrations create ends up with RLS on and no policy. A new table added
 * without a matching ALTER fails here, which is the only way anyone finds
 * out before Supabase emails them.
 *
 * Runs against embedded Postgres with no `anon` or `authenticated` role,
 * which also proves the migration is portable to a plain install.
 */
const MIGRATIONS = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
  entries: { tag: string }[]
}

describe('the public schema is locked', () => {
  it('leaves every table default-deny', async () => {
    const db = new PGlite()

    for (const { tag } of MIGRATIONS.entries) {
      const sql = readFileSync(`drizzle/${tag}.sql`, 'utf8')
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim()
        if (trimmed) await db.exec(trimmed)
      }
    }

    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by relname`,
    )

    expect(tables.rows.length).toBeGreaterThan(0)

    const unprotected = tables.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)
    expect(
      unprotected,
      `these tables would be world-readable through Supabase's REST API: ${unprotected.join(', ')}`,
    ).toEqual([])

    // No policies is the point, not an omission. A policy here would be
    // trying to describe the app's access, and the app is not the role
    // being restricted — it owns the tables and bypasses RLS entirely.
    const policies = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policies where schemaname = 'public'`,
    )
    expect(policies.rows[0]!.n).toBe(0)
  }, 120_000)
})
