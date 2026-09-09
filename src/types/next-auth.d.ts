import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      orgId: string
    } & DefaultSession['user']

    /**
     * When this session stops being valid, in epoch ms.
     *
     * Not `expires` (Auth.js's own string field, driven by the static
     * session maxAge) — this is the per-sign-in deadline set by the "keep me
     * signed in" choice. See src/lib/auth/session-window.ts for why it
     * cannot be expressed as the JWT's own `exp`.
     *
     * Optional: sessions issued before this shipped do not carry one.
     */
    expiresAt?: number
  }

  /** Returned by `authorize`, and handed to the `jwt` callback on sign-in. */
  interface User {
    orgId: string
    /** The device choice, read from the challenge row rather than the request. */
    remember?: boolean
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
    /** Epoch ms. See the note on `Session.expiresAt`. */
    expiresAt?: number
  }
}
