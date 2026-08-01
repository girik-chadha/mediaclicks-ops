/**
 * Sets a user's password.
 *
 *   npm run db:set-password -- owner@mediaclicks.ae
 *
 * The password is read from a hidden prompt, never from an argument. Passing
 * it on the command line would put it in shell history, in the process list
 * while it runs, and in any terminal scrollback — three places it does not
 * belong. The email is fine as an argument; the secret is not.
 *
 * Stopgap until the profile screen ships. Writes an audit row, because a
 * password change is exactly the kind of event an audit log exists for.
 */
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as readline from 'node:readline'
import { hashPassword } from '../src/server/auth/password'
import { auditLog, users } from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

/** Reads a line without echoing it to the terminal. */
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

    const iface = rl as unknown as { _writeToOutput: (s: string) => void }
    const original = iface._writeToOutput.bind(rl)
    iface._writeToOutput = (s: string) => {
      // Echo the question itself, then mute everything the user types.
      if (s.includes(question)) original(s)
      else original('')
    }

    rl.question(question, (answer) => {
      iface._writeToOutput = original
      process.stdout.write('\n')
      rl.close()
      resolve(answer)
    })
  })
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email) {
    throw new Error('Usage: npm run db:set-password -- <email>')
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. See .env.example.')

  const first = await prompt(`New password for ${email}: `)
  // Echo the length, never the value. Input is hidden, so a swallowed or
  // duplicated keystroke would otherwise be invisible — and it would be
  // invisible identically in the confirmation, which is how you end up
  // storing a hash of something you did not type.
  console.log(`  captured ${first.length} characters`)
  if (first.length < 12) throw new Error('Use at least 12 characters.')

  const second = await prompt('Confirm: ')
  console.log(`  captured ${second.length} characters`)
  if (first !== second) throw new Error('Those did not match. Nothing was changed.')

  const client = postgres(databaseUrl, { max: 1, prepare: false })
  const db = drizzle(client)

  try {
    const found = await db
      .select({ id: users.id, orgId: users.orgId, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    const user = found[0]
    if (!user) throw new Error(`No account for ${email}.`)

    const passwordHash = await hashPassword(first)

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id))

      await tx.insert(auditLog).values({
        orgId: user.orgId,
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'user.password_changed',
        entityType: 'user',
        entityId: user.id,
        before: null,
        // Never the hash, and obviously never the password.
        after: { email: user.email, method: 'cli' },
      })
    })

    console.log(`Password updated for ${email}.`)
    console.log('Existing sessions stay valid — they are JWTs, not database rows.')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
