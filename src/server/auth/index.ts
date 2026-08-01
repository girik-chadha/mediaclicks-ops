import 'server-only'
import { eq } from 'drizzle-orm'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { db } from '../db'
import { users } from '../db/schema'
import { authConfig } from './config'
import { hashPassword, verifyPassword } from './password'

const credentials = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1024),
})

/**
 * A hash of a value nobody can supply, verified against when no user matches.
 * Without it, a missing account returns in microseconds while a wrong
 * password takes ~50ms of argon2 work, and that difference is a reliable
 * account-enumeration oracle. Computed once at module load.
 */
const decoyHash = hashPassword(
  'decoy-e0e6a4d2-not-a-real-password-used-only-for-constant-time-failure',
)

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Work email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(raw) {
        const parsed = credentials.safeParse(raw)
        if (!parsed.success) return null

        const email = parsed.data.email.trim().toLowerCase()

        const found = await db
          .select({
            id: users.id,
            orgId: users.orgId,
            email: users.email,
            fullName: users.fullName,
            passwordHash: users.passwordHash,
            deactivatedAt: users.deactivatedAt,
          })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)

        const user = found[0]

        if (!user) {
          await verifyPassword(await decoyHash, parsed.data.password)
          return null
        }

        const ok = await verifyPassword(user.passwordHash, parsed.data.password)
        if (!ok) return null

        // Deactivated accounts stop authenticating but keep every row they
        // are referenced by (ADR 0004). Checked after the password so a
        // deactivated account is indistinguishable from a wrong password.
        if (user.deactivatedAt) return null

        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id))

        return {
          id: user.id,
          orgId: user.orgId,
          email: user.email,
          name: user.fullName,
        }
      },
    }),
  ],
})
