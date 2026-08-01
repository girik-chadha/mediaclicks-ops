import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      orgId: string
    } & DefaultSession['user']
  }

  /** Returned by `authorize`, and handed to the `jwt` callback on sign-in. */
  interface User {
    orgId: string
  }
}

/**
 * Augment `@auth/core/jwt`, not `next-auth/jwt`.
 *
 * next-auth/jwt is a bare `export * from "@auth/core/jwt"`, so declaring an
 * interface against it creates a second, unrelated JWT rather than merging
 * into the one Auth.js actually uses. The failure is quiet: `JWT extends
 * Record<string, unknown>`, so writing `token.orgId` still compiles and only
 * reads come back as `unknown`.
 */
declare module '@auth/core/jwt' {
  interface JWT {
    userId: string
    orgId: string
  }
}
