import type { NextAuthConfig } from 'next-auth'
import { REMEMBERED_MS, expiryFor, sessionExpired } from '@/lib/auth/session-window'

/**
 * The Edge-safe half of the Auth.js configuration.
 *
 * middleware.ts runs on the Edge runtime, where neither the argon2 native
 * module nor a TCP database socket exists. Keeping the providers out of this
 * file is what lets middleware import a working NextAuth instance without
 * dragging either into the Edge bundle. src/server/auth/index.ts adds the
 * credentials provider and runs on Node.
 *
 * Deliberately no permissions in the token — see
 * docs/adr/0005-permissions-resolved-per-request.md.
 */
export const authConfig = {
  // Credentials sign-in requires JWT sessions; there is no database session
  // to look up.
  //
  // maxAge is the outer ceiling, not the session length. It matches the
  // longest window anyone can be granted, so that Auth.js's own expiry never
  // cuts a remembered device short; the actual deadline is `expiresAt` below,
  // which is shorter for anyone who did not tick the box. Stated explicitly
  // rather than inherited — it happens to equal the library default today,
  // and a silent change to that default should not silently change this.
  session: { strategy: 'jwt', maxAge: REMEMBERED_MS / 1000 },

  pages: {
    signIn: '/login',
  },

  callbacks: {
    /**
     * Used by middleware to gate every route.
     *
     * /login must stay reachable while signed out or the redirect loops, and
     * must bounce to /today while signed in so the back button does not land
     * on a sign-in form for an active session.
     */
    authorized({ auth, request }) {
      // Past its window counts as signed out here too, so an expired session
      // is redirected to /login rather than being allowed to render a page
      // that then finds no actor. Enforcement still happens server-side in
      // getActor(); this only decides what the person sees.
      const live = auth?.user && !sessionExpired(auth.expiresAt)
      const signedIn = Boolean(live)
      const path = request.nextUrl.pathname
      const onLogin = path.startsWith('/login') || path.startsWith('/forgot')
      // Reached from an emailed link by someone who is, by definition, not
      // signed in — and who may be setting a first password on an account
      // that has never had one. Kept out of the redirect-when-signed-in
      // branch above as well: an admin already signed in on the same browser
      // must still be able to open a link they were sent.
      const onReset = path.startsWith('/reset/')

      if (onReset) return true

      if (onLogin) {
        if (signedIn) return Response.redirect(new URL('/today', request.nextUrl))
        return true
      }

      return signedIn
    },

    jwt({ token, user }) {
      // `user` is present only on the sign-in pass.
      if (user) {
        token.userId = user.id as string
        token.orgId = user.orgId

        // Stamped once, here, and never recomputed below — which is what
        // makes the window absolute rather than sliding. Recomputing it on
        // each pass would mean a session that never ends as long as someone
        // keeps a tab open, and "12 hours" would quietly become "12 hours
        // after you stop", which is not what the checkbox says.
        token.expiresAt = expiryFor(user.remember === true)
      }
      return token
    },

    session({ session, token }) {
      session.user.id = token.userId
      session.user.orgId = token.orgId
      session.expiresAt = token.expiresAt
      return session
    },
  },

  providers: [],
} satisfies NextAuthConfig
