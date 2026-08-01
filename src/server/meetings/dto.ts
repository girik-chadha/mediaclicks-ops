import 'server-only'
import type { MeetingDto } from '@/components/calendar/types'
import { can } from '@/lib/permissions'
import type { SessionActor } from '../auth/session'
import type { MeetingRow } from './queries'

/**
 * The single place a MeetingRow becomes a MeetingDto.
 *
 * Previously duplicated across three pages, which meant adding a field was
 * three edits and forgetting one was silent. It also carries the per-meeting
 * permission flags, so every screen hides the same controls — the server
 * still enforces on every mutation, because hiding a button is presentation
 * and never authorization (§3).
 */
export function toMeetingDto(actor: SessionActor, m: MeetingRow): MeetingDto {
  const subject = {
    orgId: actor.orgId,
    createdByUserId: m.createdByUserId,
    attendeeIds: m.attendeeIds,
  }

  return {
    id: m.id,
    title: m.title,
    description: m.description,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    type: m.type,
    status: m.status,
    conferencingProvider: m.conferencingProvider,
    conferenceUrl: m.conferenceUrl,
    clientId: m.clientId,
    clientName: m.clientName,
    clientPhone: m.clientPhone,
    attendees: m.attendees,
    canEdit: can(actor, 'meeting.edit', subject),
    canCancel: can(actor, 'meeting.delete', subject),
  }
}

/** Rows the actor may see at all, decided by can() per row rather than SQL. */
export function visibleTo(actor: SessionActor, rows: MeetingRow[]): MeetingRow[] {
  return rows.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )
}
