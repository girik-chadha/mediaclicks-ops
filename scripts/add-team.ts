/**
 * Creates or updates the real team from `team.txt`.
 *
 * Accounts are created **without a password**. Everyone sets their own by
 * going to /forgot and following the emailed link — the same flow they will
 * use if they ever forget it. That is deliberate: a temporary password has
 * to be generated, transmitted, and then trusted to be changed, and it is
 * readable by whoever it was sent through for as long as that thread exists.
 * Nobody but the account holder should ever know the password, including
 * whoever is running this script.
 *
 *   node --import tsx scripts/add-team.ts team.txt
 *   node --import tsx scripts/add-team.ts team.txt --apply
 *
 * Without `--apply` it prints what it would do and writes nothing. That is
 * the default on purpose: this runs against whatever DATABASE_URL points at,
 * which at handover time is production.
 *
 * **Idempotent, and safe to re-run against a live team.** An address that
 * already exists has its first name, last name and role brought up to date;
 * its password hash is never read, never written, never mentioned. Running
 * it twice does the second time what a no-op would, and prints so.
 *
 * The file is one entry per line:
 *
 *   someone@example.com, Owner, First, Last
 *   someone.else@example.com, Member, Onename
 *
 * Roles must already exist — Owner / Manager / Member are built in; create
 * custom ones on the Team page first.
 *
 * Requires email to be configured (RESEND_API_KEY, MAIL_FROM) with a
 * sending domain that can reach these addresses, or nobody can complete the
 * second half. The Resend sandbox address only delivers to the account that
 * owns it; see docs/runbook-go-live.md.
 */
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { splitFullName } from '../src/lib/users/name'
import { auditLog, roles, userRoles, users } from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

interface Entry {
  email: string
  roleName: string
  firstName: string
  lastName: string | null
}

/** "rohaan.fernandes336@gmail.com" -> "Rohaan Fernandes336" — a starting point. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || local
  )
}

/** Trims, strips any leading "@" (what a chat export produces), lowercases. */
export function normaliseEmail(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase()
}

function parse(path: string): Entry[] {
  const text = readFileSync(path, 'utf8')
  const out: Entry[] = []
  const seen = new Set<string>()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const [emailPart, rolePart, firstPart, lastPart] = line.split(',').map((p) => p?.trim())

    const email = normaliseEmail(emailPart ?? '')
    if (!email.includes('@')) {
      console.warn(`skipping, not an email: ${line}`)
      continue
    }
    // The same address twice in the file is a mistake in the file, not two
    // people. Refuse rather than let the last line silently win.
    if (seen.has(email)) throw new Error(`${email} appears more than once in ${path}.`)
    seen.add(email)

    const name = firstPart
      ? { firstName: firstPart, lastName: lastPart || null }
      : splitFullName(nameFromEmail(email))

    out.push({ email, roleName: rolePart || 'Member', ...name })
  }

  return out
}

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')

  if (!file) throw new Error('Usage: node --import tsx scripts/add-team.ts <file> [--apply]')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  const entries = parse(file)
  if (entries.length === 0) throw new Error('Nothing to do — no valid entries.')

  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  const db = drizzle(sql)

  try {
    // The org is whoever was seeded first, matching db:seed and db:demo.
    const [owner] = await db
      .select({ orgId: users.orgId, id: users.id, email: users.email })
      .from(users)
      .orderBy(users.createdAt)
      .limit(1)

    if (!owner) throw new Error('No users yet. Run `npm run db:seed` first.')

    const roleRows = await db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.orgId, owner.orgId))

    const unknownRoles = [
      ...new Set(entries.map((e) => e.roleName).filter((n) => !roleRows.some((r) => r.name === n))),
    ]
    if (unknownRoles.length > 0) {
      throw new Error(
        `No such role: ${unknownRoles.join(', ')}.\n` +
          `Existing roles: ${roleRows.map((r) => r.name).join(', ')}.\n` +
          'Create custom roles on the Team page first.',
      )
    }

    console.log(apply ? '\napplying:\n' : '\nDRY RUN — nothing will be written:\n')

    const created: Entry[] = []
    let updated = 0
    let unchanged = 0

    for (const entry of entries) {
      const roleId = roleRows.find((r) => r.name === entry.roleName)!.id
      const label = `${entry.email.padEnd(34)} ${entry.roleName.padEnd(8)} ${entry.firstName}${entry.lastName ? ' ' + entry.lastName : ''}`

      const [existing] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          deactivatedAt: users.deactivatedAt,
        })
        .from(users)
        .where(and(eq(users.orgId, owner.orgId), eq(users.email, entry.email)))
        .limit(1)

      if (existing) {
        const currentRoles = await db
          .select({ name: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(eq(userRoles.userId, existing.id))

        const roleSame = currentRoles.length === 1 && currentRoles[0]!.name === entry.roleName
        const nameSame =
          existing.firstName === entry.firstName && existing.lastName === entry.lastName

        if (roleSame && nameSame) {
          unchanged++
          console.log(`  ${label}  unchanged`)
          continue
        }

        console.log(`  ${label}  update${existing.deactivatedAt ? ' (deactivated — left so)' : ''}`)
        // Counted whether or not it is written: the dry run's whole job is
        // to state the totals it would produce, and a plan that reports
        // "0 to update" above fourteen rows marked "update" is a bug that
        // survived exactly one reading before it was noticed.
        updated++
        if (!apply) continue

        await db.transaction(async (tx) => {
          // Only the profile columns. `password_hash` is not in this
          // statement and is not in any statement in this file.
          await tx
            .update(users)
            .set({ firstName: entry.firstName, lastName: entry.lastName })
            .where(eq(users.id, existing.id))

          if (!roleSame) {
            await tx.delete(userRoles).where(eq(userRoles.userId, existing.id))
            await tx.insert(userRoles).values({ userId: existing.id, roleId })
          }

          await tx.insert(auditLog).values({
            orgId: owner.orgId,
            actorUserId: owner.id,
            actorEmail: owner.email,
            action: roleSame ? 'user.profile_updated' : 'user.role_changed',
            entityType: 'user',
            entityId: existing.id,
            before: {
              firstName: existing.firstName,
              lastName: existing.lastName,
              roles: currentRoles.map((r) => r.name).sort(),
            },
            after: {
              firstName: entry.firstName,
              lastName: entry.lastName,
              roles: [entry.roleName],
            },
          })
        })
        continue
      }

      console.log(`  ${label}  create`)
      created.push(entry)
      if (!apply) continue

      await db.transaction(async (tx) => {
        const [made] = await tx
          .insert(users)
          .values({
            orgId: owner.orgId,
            email: entry.email,
            firstName: entry.firstName,
            lastName: entry.lastName,
            // No password. They set their own from the emailed reset link,
            // and until they do the account cannot be signed into at all.
            passwordHash: null,
          })
          .returning({ id: users.id })

        await tx.insert(userRoles).values({ userId: made!.id, roleId })

        await tx.insert(auditLog).values({
          orgId: owner.orgId,
          actorUserId: owner.id,
          actorEmail: owner.email,
          action: 'user.created',
          entityType: 'user',
          entityId: made!.id,
          before: null,
          // Never the password or its hash. An audit log is read by people.
          after: {
            email: entry.email,
            firstName: entry.firstName,
            lastName: entry.lastName,
            roles: [entry.roleName],
          },
        })
      })
    }

    console.log(
      `\n${created.length} to create, ${updated} to update, ${unchanged} unchanged` +
        (apply ? '.' : ' — re-run with --apply to write.'),
    )
    if (!apply) return

    if (created.length > 0) {
      console.log('\n' + '='.repeat(72))
      console.log(`${created.length} account(s) created, none with a password.`)
      console.log('='.repeat(72))
      console.log('Send each person the app URL and this line:')
      console.log('')
      console.log('  Go to the sign-in page, click "Forgot password", enter this address,')
      console.log('  and follow the emailed link to choose your password. The link works')
      console.log('  once and lasts an hour.')
      console.log('')
      for (const c of created) console.log(`  ${c.email.padEnd(34)} ${c.roleName}`)
      console.log('='.repeat(72))
      console.log('Nothing secret here — there is no password to leak.')
    }
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
