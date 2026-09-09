import { NextResponse } from 'next/server'
import { runNotifications } from '@/server/notifications/worker'

// Node runtime: the worker talks to Postgres over TCP.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The notification tick.
 *
 * Called on a schedule from outside the app, five minutes apart: Vercel's
 * own cron on Pro (see `vercel.json`), which invokes over **GET** — Vercel
 * gives no way to configure a cron job to call with any other method — plus
 * an hourly `POST` from `.github/workflows/notifications.yml` as a safety
 * net on a second provider. Both are kept because Vercel's own docs call
 * cron delivery "best effort": a silently skipped tick is exactly the
 * failure a reminder system cannot have. Running twice is harmless — the
 * unique index on (user_id, type, meeting_id, scheduled_for) makes a
 * repeated tick insert nothing.
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

async function tick(request: Request): Promise<NextResponse> {
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

// GET for Vercel's own cron invoker; POST for the GitHub Actions safety net
// and for triggering a tick by hand. Identical behaviour either way — the
// method carries no meaning here, it is just what each caller happens to send.
export async function GET(request: Request): Promise<NextResponse> {
  return tick(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return tick(request)
}
