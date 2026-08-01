import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { ConferencingProvider } from '../db/schema/enums'
import { db } from '../db'
import { auditLog, meetingAttendees, meetings, users } from '../db/schema'
import { inOrg } from '../scope'
import type { SessionActor } from '../auth/session'
import { providerFor } from './providers'
import { ConferenceUnavailableError, type ConferenceContext } from './types'

export * from './types'
export { providerFor } from './providers'

/**
 * Whether a meeting is missing a link it was supposed to have.
 *
 * Derived rather than stored. A `conference_error` column would be a second
 * source of truth that can disagree with reality — this cannot, because it
 * *is* reality: the platform promises a link and there isn't one.
 */
export function needsLinkRetry(meeting: {
  conferencingProvider: ConferencingProvider
  conferenceUrl: string | null
  status: string
}): boolean {
  return (
    providerFor(meeting.conferencingProvider).generatesLink &&
    meeting.conferenceUrl === null &&
    meeting.status !== 'cancelled'
  )
}

async function contextFor(
  actor: SessionActor,
  meetingId: string,
): Promise<{ context: ConferenceContext; provider: ConferencingProvider } | null> {
  const found = await db
    .select({
      title: meetings.title,
      description: meetings.description,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      provider: meetings.conferencingProvider,
    })
    .from(meetings)
    .where(and(inOrg(meetings, actor), eq(meetings.id, meetingId)))
    .limit(1)

  const meeting = found[0]
  if (!meeting) return null

  // Attendee emails — the platforms invite people directly, and §4.3 sends
  // the invitation to everyone on the meeting, not just the client.
  const attendees = await db
    .select({ email: users.email })
    .from(meetingAttendees)
    .innerJoin(users, eq(users.id, meetingAttendees.userId))
    .where(eq(meetingAttendees.meetingId, meetingId))

  return {
    provider: meeting.provider,
    context: {
      title: meeting.title,
      description: meeting.description,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      organiserEmail: actor.email,
      attendeeEmails: attendees.map((a) => a.email),
      timezone: actor.timezone,
    },
  }
}

/**
 * Creates the join link for an already-saved meeting.
 *
 * Deliberately called *after* the meeting's transaction has committed. Doing
 * it inside would mean a slow or failing platform rolls back the meeting —
 * which is exactly what §4.2 forbids: "If Meet or Zoom fails, the meeting
 * still saves with conference_url: null and a retry action in the UI. Never
 * silently drop it."
 *
 * Returns true when a link was attached. A false is not an error the caller
 * should surface as a failure — the meeting exists either way, and
 * needsLinkRetry() will show the retry affordance.
 */
export async function attachConferenceLink(
  actor: SessionActor,
  meetingId: string,
): Promise<boolean> {
  const resolved = await contextFor(actor, meetingId)
  if (!resolved) return false

  const provider = providerFor(resolved.provider)
  if (!provider.generatesLink) return false

  try {
    const details = await provider.create(resolved.context)
    if (!details.url) return false

    await db
      .update(meetings)
      .set({ conferenceUrl: details.url, conferenceExternalId: details.externalId })
      .where(and(inOrg(meetings, actor), eq(meetings.id, meetingId)))

    return true
  } catch (error) {
    if (error instanceof ConferenceUnavailableError) {
      // Recorded, not thrown. §4.2 wants the meeting kept and a retry offered;
      // an audit row makes the failure visible rather than merely absent.
      await db.insert(auditLog).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        actorEmail: actor.email,
        action: 'meeting.link_failed',
        entityType: 'meeting',
        entityId: meetingId,
        before: null,
        after: { provider: resolved.provider, reason: error.reason },
      })
      return false
    }
    throw error
  }
}

/** Revokes a link when a meeting is cancelled. Never blocks the cancellation. */
export async function revokeConferenceLink(
  actor: SessionActor,
  meetingId: string,
): Promise<void> {
  const found = await db
    .select({
      provider: meetings.conferencingProvider,
      externalId: meetings.conferenceExternalId,
    })
    .from(meetings)
    .where(and(inOrg(meetings, actor), eq(meetings.id, meetingId)))
    .limit(1)

  const meeting = found[0]
  if (!meeting?.externalId) return

  try {
    await providerFor(meeting.provider).cancel(meeting.externalId)
  } catch {
    // A stale link on a cancelled meeting is untidy, not harmful. Failing the
    // cancellation because the platform is down would be worse.
  }
}
