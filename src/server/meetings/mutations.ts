import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { MeetingInput, MeetingUpdateInput } from '@/lib/meetings/schema'
import { requirePermission } from '../auth/require'
import { requireActor, type SessionActor } from '../auth/session'
import { db } from '../db'
import { auditLog, meetingAttendees, meetings } from '../db/schema'
import { inOrg } from '../scope'
import { getMeeting, type MeetingRow } from './queries'

/**
 * Every mutation here has the same shape:
 *
 *   resolve actor → requirePermission with a real subject → write + audit
 *   inside one transaction
 *
 * The audit row is not a separate call a caller might forget. It is written
 * in the same transaction as the change it describes (ADR 0003), so they
 * commit together or not at all.
 */

/** Not-found and cross-org are the same error on purpose: revealing that a
 *  meeting exists in another organisation is itself a leak. */
export class MeetingNotFoundError extends Error {
  override readonly name = 'MeetingNotFoundError'
  constructor() {
    super('That meeting no longer exists.')
  }
}

/** What an audit row records. Deliberately a summary, not the whole row. */
function auditShape(m: {
  title: string
  startsAt: Date
  endsAt: Date
  type: string
  status?: string
  conferencingProvider: string
  clientId: string | null
  attendeeIds: readonly string[]
}) {
  return {
    title: m.title,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    type: m.type,
    ...(m.status ? { status: m.status } : {}),
    provider: m.conferencingProvider,
    clientId: m.clientId,
    attendees: [...m.attendeeIds].sort(),
  }
}

export async function createMeeting(input: MeetingInput): Promise<string> {
  // The actor is resolved first because the subject needs their org and id.
  // getActor is request-cached, so requirePermission below does not re-query.
  const me = await requireActor()

  // §4.1.1: adding anyone other than yourself requires meeting.create.any.
  // At creation the subject is the proposed attendee set — there is no
  // meeting yet — which is exactly what OWNS['meeting.create'] inspects.
  const actor = await requirePermission('meeting.create', {
    orgId: me.orgId,
    createdByUserId: me.id,
    attendeeIds: input.attendeeIds,
  })

  const clientId = input.type === 'client' ? input.clientId : null

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(meetings)
      .values({
        orgId: actor.orgId,
        title: input.title,
        description: input.description ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        type: input.type,
        clientId,
        createdByUserId: actor.id,
        conferencingProvider: input.conferencingProvider,
        // §4.2: the link is created by the provider integration in Phase 4.
        // The meeting saves either way and is never silently dropped.
        conferenceUrl: null,
        status: 'scheduled',
      })
      .returning({ id: meetings.id })

    const meetingId = inserted[0]!.id

    await tx.insert(meetingAttendees).values(
      input.attendeeIds.map((userId) => ({
        meetingId,
        userId,
        // Whoever created it has implicitly accepted; everyone else pending.
        response: userId === actor.id ? ('accepted' as const) : ('pending' as const),
      })),
    )

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'meeting.created',
      entityType: 'meeting',
      entityId: meetingId,
      before: null,
      after: auditShape({ ...input, clientId }),
    })

    return meetingId
  })
}

export async function updateMeeting(input: MeetingUpdateInput): Promise<void> {
  const { actor, existing } = await loadForWrite(input.id)

  await requirePermission('meeting.edit', {
    orgId: existing.orgId,
    createdByUserId: existing.createdByUserId,
    attendeeIds: existing.attendeeIds,
  })

  const clientId = input.type === 'client' ? input.clientId : null

  await db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({
        title: input.title,
        description: input.description ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        type: input.type,
        clientId,
        conferencingProvider: input.conferencingProvider,
      })
      .where(and(inOrg(meetings, actor), eq(meetings.id, input.id)))

    // Replace rather than diff: the attendee list is small and a wholesale
    // rewrite cannot leave a stale row behind.
    await tx.delete(meetingAttendees).where(eq(meetingAttendees.meetingId, input.id))
    await tx.insert(meetingAttendees).values(
      input.attendeeIds.map((userId) => ({
        meetingId: input.id,
        userId,
        response: userId === actor.id ? ('accepted' as const) : ('pending' as const),
      })),
    )

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'meeting.updated',
      entityType: 'meeting',
      entityId: input.id,
      before: auditShape(existing),
      after: auditShape({ ...input, clientId }),
    })
  })
}

/**
 * Cancels rather than deletes. The row survives so attendance, audit history
 * and any transcript stay attributable — §2's status enum exists for this.
 */
export async function cancelMeeting(id: string, reason?: string): Promise<void> {
  const { actor, existing } = await loadForWrite(id)

  await requirePermission('meeting.delete', {
    orgId: existing.orgId,
    createdByUserId: existing.createdByUserId,
    attendeeIds: existing.attendeeIds,
  })

  await db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({ status: 'cancelled' })
      .where(and(inOrg(meetings, actor), eq(meetings.id, id)))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'meeting.cancelled',
      entityType: 'meeting',
      entityId: id,
      before: auditShape(existing),
      after: { ...auditShape(existing), status: 'cancelled', reason: reason ?? null },
    })
  })
}

/** The pre-image an audit row needs, read through the org-scoped query. */
async function loadForWrite(
  id: string,
): Promise<{ actor: SessionActor; existing: MeetingRow & { orgId: string } }> {
  const actor = await requireActor()
  const meeting = await getMeeting(actor, id)
  if (!meeting) throw new MeetingNotFoundError()
  return { actor, existing: { ...meeting, orgId: actor.orgId } }
}
