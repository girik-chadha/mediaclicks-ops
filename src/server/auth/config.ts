import type { NextAuthConfig } from 'next-auth'

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
  session: { strategy: 'jwt' },

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
      const signedIn = Boolean(auth?.user)
      const path = request.nextUrl.pathname
      const onLogin = path.startsWith('/login') || path.startsWith('/forgot')

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
      }
      return token
    },

    session({ session, token }) {
      session.user.id = token.userId
      session.user.orgId = token.orgId
      return session
    },
  },

  providers: [],
} satisfies NextAuthConfig
