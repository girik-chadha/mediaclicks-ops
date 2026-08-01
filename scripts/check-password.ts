/**
 * Checks a password against the stored hash, without signing in.
 *
 *   npm run db:check-password -- owner@mediaclicks.ae
 *
 * Isolates "the password is wrong" from "the sign-in flow is broken". It
 * runs exactly the comparison the credentials provider runs, so if this says
 * yes and the app says no, the fault is in the app, not the password.
 *
 * Read-only. Changes nothing.
 */
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as readline from 'node:readline'
import { verifyPassword } from '../src/server/auth/password'
import { users } from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const iface = rl as unknown as { _writeToOutput: (s: string) => void }
    const original = iface._writeToOutput.bind(rl)
    iface._writeToOutput = (s: string) => {
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
  if (!email) throw new Error('Usage: npm run db:check-password -- <email>')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  const client = postgres(databaseUrl, { max: 1, prepare: false })
  const db = drizzle(client)

  try {
    const found = await db
      .select({
        email: users.email,
        passwordHash: users.passwordHash,
        deactivatedAt: users.deactivatedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    const user = found[0]
    if (!user) {
      const all = await db.select({ email: users.email }).from(users)
      console.log(`No account for "${email}".`)
      console.log('Accounts that do exist:')
      all.forEach((u) => console.log('  ' + u.email))
      return
    }

    console.log(`account:      ${user.email}`)
    console.log(`deactivated:  ${user.deactivatedAt ? 'YES — sign-in is blocked' : 'no'}`)
    console.log(`hash present: ${user.passwordHash ? 'yes' : 'NO — no password set'}`)
    if (user.passwordHash) {
      console.log(`hash type:    ${user.passwordHash.split('$')[1] ?? 'unknown'}`)
    }

    const candidate = await prompt('Password to test: ')
    console.log(`length typed: ${candidate.length} characters`)

    const ok = await verifyPassword(user.passwordHash, candidate)
    console.log(ok ? '\nMATCH — this password is correct.' : '\nNO MATCH — this is not the stored password.')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
