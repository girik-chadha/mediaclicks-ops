/**
 * Creates the real team from a list of email addresses.
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
 * The file is one entry per line:
 *
 *   someone@example.com
 *   someone.else@example.com, Owner
 *   third@example.com, GFX, Third Person
 *
 * Role defaults to Member and must already exist — create custom roles on
 * the Team page first, then run this. Names default to a readable guess from
 * the address, which people can correct in Profile.
 *
 * Requires email to be configured (RESEND_API_KEY, MAIL_FROM), or nobody can
 * complete the second half.
 */
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { auditLog, roles, userRoles, users } from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

interface Entry {
  email: string
  roleName: string
  fullName: string
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

function parse(path: string): Entry[] {
  const text = readFileSync(path, 'utf8')
  const out: Entry[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const [emailPart, rolePart, namePart] = line.split(',').map((p) => p?.trim())

    // A stray leading '@' is what copying out of a chat export produces.
    const email = (emailPart ?? '').replace(/^@+/, '').toLowerCase()
    if (!email.includes('@')) {
      console.warn(`skipping, not an email: ${line}`)
      continue
    }

    out.push({
      email,
      roleName: rolePart || 'Member',
      fullName: namePart || nameFromEmail(email),
    })
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

    console.log(apply ? '\ncreating accounts:\n' : '\nDRY RUN — nothing will be written:\n')
    const created: { email: string; role: string; name: string }[] = []

    for (const entry of entries) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, entry.email))
        .limit(1)

      if (existing) {
        console.log(`  ${entry.email.padEnd(38)} already exists, skipped`)
        continue
      }

      if (!apply) {
        console.log(`  ${entry.email.padEnd(38)} ${entry.roleName.padEnd(10)} ${entry.fullName}`)
        continue
      }

      const roleId = roleRows.find((r) => r.name === entry.roleName)!.id

      await db.transaction(async (tx) => {
        const [made] = await tx
          .insert(users)
          .values({
            orgId: owner.orgId,
            email: entry.email,
            fullName: entry.fullName,
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
          after: { email: entry.email, fullName: entry.fullName, roles: [entry.roleName] },
        })
      })

      created.push({ email: entry.email, role: entry.roleName, name: entry.fullName })
      console.log(`  ${entry.email.padEnd(38)} ${entry.roleName.padEnd(10)} created`)
    }

    if (!apply) {
      console.log('\nre-run with --apply to create these accounts.')
      return
    }

    if (created.length > 0) {
      console.log('\n' + '='.repeat(72))
      console.log(`${created.length} account(s) created, none with a password.`)
      console.log('='.repeat(72))
      console.log('Send each person the app URL and this line:')
      console.log('')
      console.log('  Go to /forgot, enter this email address, and follow the link')
      console.log('  to choose your password. The link works once and lasts an hour.')
      console.log('')
      for (const c of created) {
        console.log(`  ${c.email.padEnd(38)} ${c.role}`)
      }
      console.log('='.repeat(72))
      console.log('Nothing secret here — there is no password to leak.')
    }
  } finally {
    await sql.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
