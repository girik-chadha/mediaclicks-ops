import { NextResponse } from 'next/server'
import { runNotifications } from '@/server/notifications/worker'

// Node runtime: the worker talks to Postgres over TCP.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The notification tick.
 *
 * Called on a schedule from outside the app, because Vercel's Hobby plan
 * caps cron at once a day and a thirty-minute reminder needs minutes. A
 * GitHub Actions schedule does the calling — see
 * .github/workflows/notifications.yml.
 *
 * Guarded by a shared secret rather than a session: there is no user here.
 * Compared in constant time, because a timing-variable comparison on a
 * long-lived secret is exactly the kind of thing that is fine until it is not.
 */
function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    // No detail: an unauthenticated caller learns nothing about whether the
    // secret is set, wrong, or the route exists at all.
    return new NextResponse('Not found', { status: 404 })
  }

  try {
    const report = await runNotifications()
    return NextResponse.json({ ok: true, ...report })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'failed' },
      { status: 500 },
    )
  }
}
