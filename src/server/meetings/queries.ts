import 'server-only'
import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { overlaps } from '@/lib/time'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import { clients, meetingAttendees, meetings, users } from '../db/schema'
import { inOrg } from '../scope'

export interface MeetingRow {
  id: string
  title: string
  description: string | null
  startsAt: Date
  endsAt: Date
  type: 'client' | 'internal'
  status: 'scheduled' | 'cancelled' | 'completed'
  conferencingProvider: 'google_meet' | 'zoom' | 'whatsapp' | 'none'
  conferenceUrl: string | null
  createdByUserId: string
  clientId: string | null
  clientName: string | null
  clientPhone: string | null
  attendeeIds: string[]
  attendees: { id: string; fullName: string; response: string }[]
}

/**
 * Meetings overlapping [from, to), scoped to the actor's organisation.
 *
 * Uses `starts_at < to AND ends_at > from` rather than `starts_at BETWEEN`,
 * so a meeting already in progress when the window opens is included. A week
 * view that hides the call you are currently in would be a strange product.
 */
export async function listMeetingsInRange(
  actor: SessionActor,
  from: Date,
  to: Date,
): Promise<MeetingRow[]> {
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      description: meetings.description,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      type: meetings.type,
      status: meetings.status,
      conferencingProvider: meetings.conferencingProvider,
      conferenceUrl: meetings.conferenceUrl,
      createdByUserId: meetings.createdByUserId,
      clientId: meetings.clientId,
      clientName: clients.companyName,
      clientPhone: clients.phoneE164,
    })
    .from(meetings)
    .leftJoin(clients, eq(clients.id, meetings.clientId))
    .where(and(inOrg(meetings, actor), lt(meetings.startsAt, to), gte(meetings.endsAt, from)))
    .orderBy(asc(meetings.startsAt))

  if (rows.length === 0) return []

  const attendeeRows = await db
    .select({
      meetingId: meetingAttendees.meetingId,
      userId: meetingAttendees.userId,
      response: meetingAttendees.response,
      fullName: users.fullName,
    })
    .from(meetingAttendees)
    .innerJoin(users, eq(users.id, meetingAttendees.userId))
    .where(
      inArray(
        meetingAttendees.meetingId,
        rows.map((r) => r.id),
      ),
    )

  const byMeeting = new Map<string, typeof attendeeRows>()
  for (const a of attendeeRows) {
    const list = byMeeting.get(a.meetingId) ?? []
    list.push(a)
    byMeeting.set(a.meetingId, list)
  }

  return rows.map((row) => {
    const attendees = byMeeting.get(row.id) ?? []
    return {
      ...row,
      attendeeIds: attendees.map((a) => a.userId),
      attendees: attendees.map((a) => ({
        id: a.userId,
        fullName: a.fullName,
        response: a.response,
      })),
    }
  })
}

/**
 * Meetings the actor may see, applying `can()` per row.
 *
 * Filtering after the fact rather than in SQL keeps one definition of the
 * rule. A `WHERE` clause encoding "created by me OR I attend OR I hold
 * meeting.view.all" is a second copy of `can()` written in a different
 * language, and the two would drift.
 */
export async function listVisibleMeetings(
  actor: SessionActor,
  from: Date,
  to: Date,
  can: (m: MeetingRow) => boolean,
): Promise<MeetingRow[]> {
  const all = await listMeetingsInRange(actor, from, to)
  return all.filter(can)
}

export async function getMeeting(
  actor: SessionActor,
  id: string,
): Promise<MeetingRow | null> {
  const from = new Date(0)
  const to = new Date(8.64e15)
  const rows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(inOrg(meetings, actor), eq(meetings.id, id)))
    .limit(1)

  if (rows.length === 0) return null
  const found = await listMeetingsInRange(actor, from, to)
  return found.find((m) => m.id === id) ?? null
}

export interface Conflict {
  userId: string
  fullName: string
  meetingId: string
  meetingTitle: string
  startsAt: Date
  endsAt: Date
}

/**
 * Attendees already busy in this window (§4.1: warn, never block).
 *
 * Cancelled meetings do not conflict — the slot is free again.
 */
export async function findConflicts(
  actor: SessionActor,
  params: {
    startsAt: Date
    endsAt: Date
    attendeeIds: readonly string[]
    excludeMeetingId?: string
  },
): Promise<Conflict[]> {
  if (params.attendeeIds.length === 0) return []

  const conditions = [
    inOrg(meetings, actor),
    ne(meetings.status, 'cancelled'),
    lt(meetings.startsAt, params.endsAt),
    gte(meetings.endsAt, params.startsAt),
    inArray(meetingAttendees.userId, [...params.attendeeIds]),
  ]

  if (params.excludeMeetingId) {
    conditions.push(ne(meetings.id, params.excludeMeetingId))
  }

  const rows = await db
    .select({
      userId: meetingAttendees.userId,
      fullName: users.fullName,
      meetingId: meetings.id,
      meetingTitle: meetings.title,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
    })
    .from(meetings)
    .innerJoin(meetingAttendees, eq(meetingAttendees.meetingId, meetings.id))
    .innerJoin(users, eq(users.id, meetingAttendees.userId))
    .where(and(...conditions))

  // The SQL window is inclusive at the edges; `overlaps` is half-open, so a
  // meeting that ends exactly when this one starts is not a conflict.
  return rows.filter((r) =>
    overlaps(r.startsAt, r.endsAt, params.startsAt, params.endsAt),
  )
}

export async function listTeam(actor: SessionActor) {
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(inOrg(users, actor))
    .orderBy(asc(users.fullName))
}

export async function listClients(actor: SessionActor) {
  return db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      region: clients.region,
      phoneE164: clients.phoneE164,
      // Carried so the meeting form can say, at the moment of choosing,
      // whether this client can actually be emailed the invite.
      email: clients.email,
    })
    .from(clients)
    .where(inOrg(clients, actor))
    .orderBy(asc(clients.companyName))
}
