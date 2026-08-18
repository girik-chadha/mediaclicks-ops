/**
 * Copies every row in `public` from one Postgres to another.
 *
 * Written for the Singapore → Mumbai move (docs/runbook-region-move.md), but
 * it knows nothing about regions: it copies whatever OLD_DATABASE_URL has
 * into whatever NEW_DATABASE_URL has.
 *
 *   node scripts/copy-to-new-db.mjs --dry-run     # plan only, writes nothing
 *   node scripts/copy-to-new-db.mjs               # copy
 *
 * It does NOT create tables. Run `npm run db:migrate` against the new
 * database first, so the schema arrives through the same migration journal
 * as everywhere else — including 0005, which is what closes the PostgREST
 * hole. Copying a schema by hand is how a security migration gets left
 * behind on the old server.
 *
 * Insert order is computed from the live foreign-key graph rather than
 * hardcoded, so a table added later cannot quietly land in the wrong place.
 * The alternative — disabling triggers — needs privileges Supabase does not
 * hand out, and silently skips FK validation even when it works.
 */
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const DRY = process.argv.includes('--dry-run')
const BATCH = 500

function urlFrom(name, fallbackFile) {
  if (process.env[name]) return process.env[name]
  if (!fallbackFile) return null
  try {
    const text = readFileSync(new URL(fallbackFile, import.meta.url), 'utf8')
    return /DATABASE_URL\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null
  } catch {
    return null
  }
}

const OLD = urlFrom('OLD_DATABASE_URL', '../.env.local')
const NEW = urlFrom('NEW_DATABASE_URL', null)

if (!OLD || !NEW) {
  console.error(
    'Set both URLs first.\n\n' +
      '  PowerShell:\n' +
      '    $env:OLD_DATABASE_URL="postgresql://...singapore..."\n' +
      '    $env:NEW_DATABASE_URL="postgresql://...mumbai..."\n\n' +
      'OLD_DATABASE_URL defaults to DATABASE_URL in .env.local if unset.',
  )
  process.exit(1)
}

if (OLD === NEW) {
  console.error('OLD and NEW are the same database. Refusing.')
  process.exit(1)
}

const opts = (url) => ({ prepare: new URL(url).port !== '6543', max: 4 })
const from = postgres(OLD, opts(OLD))
const to = postgres(NEW, opts(NEW))

/** Tables in `public`, excluding drizzle's own bookkeeping. */
async function tablesOf(sql) {
  const rows = await sql`
    select table_name as name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name`
  return rows.map((r) => r.name).filter((n) => !n.startsWith('__drizzle'))
}

/** child → [parents], within public, ignoring self-references. */
async function dependencies(sql) {
  const rows = await sql`
    select
      c.conrelid::regclass::text  as child,
      c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_class ch on ch.oid = c.conrelid
    join pg_namespace n on n.oid = ch.relnamespace
    where c.contype = 'f' and n.nspname = 'public'`

  const deps = new Map()
  for (const r of rows) {
    const child = r.child.replace(/^public\./, '').replace(/"/g, '')
    const parent = r.parent.replace(/^public\./, '').replace(/"/g, '')
    if (child === parent) continue
    if (!deps.has(child)) deps.set(child, new Set())
    deps.get(child).add(parent)
  }
  return deps
}

/** Parents before children. Throws rather than guessing if a cycle exists. */
function ordered(tables, deps) {
  const done = new Set()
  const out = []
  let safety = tables.length + 1

  while (out.length < tables.length && safety-- > 0) {
    for (const t of tables) {
      if (done.has(t)) continue
      const needs = [...(deps.get(t) ?? [])].filter((p) => tables.includes(p))
      if (needs.every((p) => done.has(p))) {
        done.add(t)
        out.push(t)
      }
    }
  }

  if (out.length < tables.length) {
    throw new Error(
      `Foreign-key cycle involving: ${tables.filter((t) => !done.has(t)).join(', ')}`,
    )
  }
  return out
}

try {
  const [oldTables, newTables] = await Promise.all([tablesOf(from), tablesOf(to)])

  const missing = oldTables.filter((t) => !newTables.includes(t))
  if (missing.length > 0) {
    console.error(
      `The new database is missing: ${missing.join(', ')}\n` +
        'Run `npm run db:migrate` against it first.',
    )
    process.exit(1)
  }

  const order = ordered(oldTables, await dependencies(from))
  console.log(`\n${order.length} tables, parents first:\n  ${order.join('\n  ')}\n`)

  // Refuse to copy into a database that already holds data — running this
  // twice would double every row, and a partly-doubled database is worse
  // than an empty one because it looks like it worked.
  if (!DRY) {
    for (const t of order) {
      const [{ count }] = await to`select count(*)::int as count from ${to(t)}`
      if (count > 0) {
        console.error(
          `\n"${t}" already has ${count} row(s) in the new database.\n` +
            'Copy into an empty database only. To start over:\n' +
            `  truncate ${order.join(', ')} cascade;`,
        )
        process.exit(1)
      }
    }
  }

  let total = 0
  for (const table of order) {
    const rows = await from`select * from ${from(table)}`
    if (rows.length === 0) {
      console.log(`${table.padEnd(24)} 0`)
      continue
    }

    if (!DRY) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH)
        await to`insert into ${to(table)} ${to(slice)}`
      }
    }

    total += rows.length
    console.log(`${table.padEnd(24)} ${rows.length}${DRY ? ' (dry run)' : ''}`)
  }

  console.log(`\n${DRY ? 'Would copy' : 'Copied'} ${total} rows.`)

  if (!DRY) {
    console.log('\nVerifying counts match…')
    let ok = true
    for (const table of order) {
      const [a] = await from`select count(*)::int as count from ${from(table)}`
      const [b] = await to`select count(*)::int as count from ${to(table)}`
      if (a.count !== b.count) {
        ok = false
        console.log(`  MISMATCH ${table}: old ${a.count}, new ${b.count}`)
      }
    }
    console.log(ok ? '  every table matches.' : '  counts differ — do not switch over.')
    if (!ok) process.exitCode = 1
  }
} catch (error) {
  console.error('\nFailed:', error.message)
  process.exitCode = 1
} finally {
  await from.end()
  await to.end()
}
