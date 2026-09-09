import 'server-only'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { z } from 'zod'
import { db } from '../db'
import { users } from '../db/schema'
import { twoFactorRequired } from './challenge'
import { authConfig } from './config'
import { openGrant } from './grant'
import { hashPassword, verifyPassword } from './password'
import { expiryFor } from '@/lib/auth/session-window'

/**
 * The cookie that carries the device choice across an OAuth round trip.
 *
 * The checkbox sits above both buttons in the design, so ticking it and then
 * clicking Google has to mean what it says. There is nowhere in the OAuth
 * handshake to put it — `redirectTo` is navigation, not a claim, and
 * anything the browser hands back after the fact is the browser choosing its
 * own session length. So it is written httpOnly before the redirect and read
 * once on the way back.
 */
export const REMEMBER_COOKIE = 'mc.remember'

const passwordCredentials = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1024),
})

const grantCredentials = z.object({
  grant: z.string().min(1).max(4096),
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

/** The columns a session needs, for whichever provider is asking. */
const accountColumns = {
  id: users.id,
  orgId: users.orgId,
  email: users.email,
  fullName: users.fullName,
  passwordHash: users.passwordHash,
  deactivatedAt: users.deactivatedAt,
}

async function accountByEmail(email: string) {
  const [row] = await db
    .select(accountColumns)
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)
  return row ?? null
}

async function markSignedIn(userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      credentials: {
        email: { label: 'Work email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        grant: { type: 'text' },
        remember: { type: 'text' },
      },

      async authorize(raw) {
        /**
         * Path one: a completed second factor.
         *
         * The code was checked, and the challenge row consumed, before this
         * grant was minted. Nothing here re-checks the code — it re-checks
         * the *account*, because a person can be deactivated between the two
         * screens and the earlier check is no longer current.
         */
        const asGrant = grantCredentials.safeParse(raw)
        if (asGrant.success) {
          const grant = openGrant(asGrant.data.grant)
          if (!grant) return null

          const [user] = await db
            .select(accountColumns)
            .from(users)
            .where(eq(users.id, grant.userId))
            .limit(1)

          if (!user || user.deactivatedAt) return null

          await markSignedIn(user.id)
          return {
            id: user.id,
            orgId: user.orgId,
            email: user.email,
            name: user.fullName,
            remember: grant.remember,
          }
        }

        /**
         * Path two: email and password, in one step.
         *
         * Refused outright when a second factor is required — and refused
         * *before* the password is even looked at, so this cannot be used as
         * an oracle for whether a password is right.
         *
         * This branch is the reason the check belongs here rather than in
         * the login form. `/api/auth/callback/credentials` is a public
         * endpoint: anyone can POST an email and password straight to it. If
         * the second factor were enforced only by the UI, the UI would be a
         * suggestion and the whole feature would be bypassable by anyone who
         * read the network tab once.
         */
        if (twoFactorRequired()) return null

        const parsed = passwordCredentials.safeParse(raw)
        if (!parsed.success) return null

        const user = await accountByEmail(parsed.data.email)

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

        await markSignedIn(user.id)

        return {
          id: user.id,
          orgId: user.orgId,
          email: user.email,
          name: user.fullName,
          // No checkbox reaches this path in the deployed UI, but the field
          // exists and a direct caller could set it, so it is read rather
          // than assumed — and defaults to the shorter window.
          remember: raw?.remember === 'true' || raw?.remember === '1',
        }
      },
    }),

    /**
     * Only present when configured. Listing it unconditionally would put a
     * provider on the sign-in endpoint that 500s on use, and the login screen
     * decides what to show from the same variable.
     */
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // No account is ever created from a Google profile — see the
            // signIn callback. This only asks for what is needed to match one.
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * The allowlist, and there is deliberately no second list to maintain.
     *
     * "Only registered emails may use Google" is exactly "an active row
     * already exists in `users`". Keeping a separate allowlist would mean two
     * places to add someone and two places to forget to remove them; the
     * team screen is already where people are added and deactivated, so it is
     * already the answer to who may sign in.
     *
     * Google sign-in does not then also demand an emailed code. Google has
     * already proved control of that mailbox, more strongly than a six-digit
     * code sent to it — asking for one afterwards would be theatre.
     */
    async signIn({ account, profile, user }) {
      if (account?.provider !== 'google') return true

      // An unverified Google address proves nothing: Google will hand out a
      // profile whose email the holder has never demonstrated they own.
      if (profile?.email_verified !== true) return false

      const email = profile.email?.trim().toLowerCase()
      if (!email) return false

      const row = await accountByEmail(email)
      if (!row || row.deactivatedAt) return false

      // Carried to the jwt callback below, which needs our id rather than
      // Google's subject.
      user.id = row.id
      user.orgId = row.orgId
      return true
    },

    /**
     * Overrides the Edge-safe version in config.ts, which cannot do this.
     *
     * A Google sign-in arrives with Google's identity, so the internal id and
     * org have to be attached here — and the device choice recovered from the
     * cookie set before the redirect, since the OAuth round trip carries
     * nothing of ours.
     */
    async jwt(params) {
      const { token, user, account } = params

      if (user && account?.provider === 'google') {
        token.userId = user.id as string
        token.orgId = user.orgId

        let remember = false
        try {
          const jar = await cookies()
          remember = jar.get(REMEMBER_COOKIE)?.value === '1'
        } catch {
          // Outside a request scope. The shorter window is the safe default.
        }
        token.expiresAt = expiryFor(remember)

        await markSignedIn(token.userId)
        return token
      }

      return authConfig.callbacks.jwt(params)
    },
  },
})
