import { NextResponse, type NextRequest } from 'next/server'
import { signOut } from '@/server/auth'

/**
 * Clears a session whose user no longer exists, then sends them to sign in.
 *
 * The loop this breaks:
 *
 *   1. The browser holds a JWT signed with AUTH_SECRET, naming a user id.
 *   2. Middleware runs on the Edge, where there is no database. It checks the
 *      signature, sees a user, and allows the page through.
 *   3. The page resolves the actor against the database, finds no such row,
 *      and redirects to /login.
 *   4. Middleware sees the same still-valid cookie and redirects to /today.
 *   5. Go to 2.
 *
 * Neither half is wrong on its own. The token really is authentic — it just
 * describes someone who is not there any more, and only the Node side can
 * know that. Redirecting to /login cannot help, because /login is exactly
 * where middleware refuses to let a signed-in request stay.
 *
 * It happens whenever the database is replaced while AUTH_SECRET stays put:
 * a region move, a restore from backup, a reseed. That is rare but it is
 * also precisely when someone is already busy — and the symptom is an
 * unusable app rather than an error, which is the worst way to spend an
 * afternoon.
 *
 * Under /api so the middleware matcher skips it. A route that exists to fix
 * a middleware redirect must not be subject to one.
 */
export async function GET(request: NextRequest) {
  // redirect: false — clear the cookies, then send the response ourselves, so
  // the destination is this app's /login rather than Auth.js's default.
  await signOut({ redirect: false })

  const url = new URL('/login', request.nextUrl.origin)
  url.searchParams.set('reason', 'stale')
  return NextResponse.redirect(url)
}
