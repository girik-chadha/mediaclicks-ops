import NextAuth from 'next-auth'
import { authConfig } from '@/server/auth/config'

/**
 * Imports the Edge-safe config directly, never src/server/auth — that module
 * pulls in argon2 and Postgres, neither of which exists on the Edge runtime.
 *
 * This is a redirect for unauthenticated traffic, not an authorization check.
 * Every mutation still calls requirePermission() server-side; middleware only
 * decides whether you see a page or the login screen.
 */
export const { auth: middleware } = NextAuth(authConfig)

export const config = {
  matcher: [
    /**
     * Everything except API routes, Next internals and static files.
     *
     * All of `api/`, not just `api/auth`: route handlers authorise
     * themselves, and there is no version of "redirect this API call to an
     * HTML login page" that helps a caller. The notification worker sends a
     * bearer token and was getting a 307 to /login, which would have failed
     * silently on a schedule nobody watches.
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)',
  ],
}
