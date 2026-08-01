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
    /** Used by middleware to gate every route. */
    authorized({ auth }) {
      return Boolean(auth?.user)
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
