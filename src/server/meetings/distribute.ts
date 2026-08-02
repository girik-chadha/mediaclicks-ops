import 'server-only'
import { and, eq } from 'drizzle-orm'
import { directMessageKey } from '@/lib/chat/keys'
import { formatRange } from '@/lib/time'
import { providerLabel } from '@/lib/meetings/schema'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import {
  auditLog,
  channelMembers,
  channels,
  clients,
  meetingAttendees,
  meetings,
  messages,
} from '../db/schema'
import { MailUnavailableError, mailIsConfigured, sendEmail } from '../mail'
import { inOrg } from '../scope'

/**
 * Distributes a meeting once it exists: the team get it in chat, the client
 * gets it by email.
 *
 * Always called *after* the meeting's transaction commits. A chat write or a
 * mail outage must never roll back a saved meeting — the same rule the link
 * layer followed, and the reason it is a separate function rather than part
 * of the insert.
 *
 * Failures are recorded to the audit log rather than thrown. The organiser
 * finds out from the meeting's own audit trail, not from losing their work.
 */
export async function distributeMeeting(
  actor: SessionActor,
  meetingId: string,
  kind: 'created' | 'updated',
): Promise<{ chatted: number; emailed: boolean }> {
  const [meeting] = await db
    .select({
      title: meetings.title,
      description: meetings.description,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      provider: meetings.conferencingProvider,
      url: meetings.conferenceUrl,
      clientId: meetings.clientId,
      clientName: clients.companyName,
      clientEmail: clients.email,
    })
    .from(meetings)
    .leftJoin(clients, eq(clients.id, meetings.clientId))
    .where(and(inOrg(meetings, actor), eq(meetings.id, meetingId)))
    .limit(1)

  if (!meeting) return { chatted: 0, emailed: false }

  const recipients = await db
    .select({ userId: meetingAttendees.userId })
    .from(meetingAttendees)
    .where(eq(meetingAttendees.meetingId, meetingId))

  const zone = actor.timezone
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: zone,
  }).format(meeting.startsAt)

  const when = `${date} · ${formatRange(meeting.startsAt, meeting.endsAt, zone)}`
  const heading = kind === 'created' ? 'New meeting' : 'Meeting updated'

  const body = [
    `${heading}: ${meeting.title}`,
    when,
    meeting.clientName ? `Client: ${meeting.clientName}` : null,
    meeting.url
      ? `${providerLabel(meeting.provider)}: ${meeting.url}`
      : `${providerLabel(meeting.provider)} — no link`,
    meeting.description || null,
  ]
    .filter(Boolean)
    .join('\n')

  // ── Team, in chat ──────────────────────────────────────────────────────
  let chatted = 0
  for (const recipient of recipients) {
    if (recipient.userId === actor.id) continue
    try {
      await sendDirectMessage(actor, recipient.userId, body)
      chatted += 1
    } catch {
      // One undeliverable message must not stop the rest.
    }
  }

  // ── Client, by email ───────────────────────────────────────────────────
  let emailed = false
  if (meeting.clientEmail) {
    try {
      if (!mailIsConfigured()) throw new MailUnavailableError('email is not configured yet')
      await sendEmail({
        to: meeting.clientEmail,
        subject: `${meeting.title} — ${when}`,
        text: body,
      })
      emailed = true
    } catch (error) {
      await db.insert(auditLog).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        actorEmail: actor.email,
        action: 'meeting.email_failed',
        entityType: 'meeting',
        entityId: meetingId,
        before: null,
        after: {
          to: meeting.clientEmail,
          reason: error instanceof Error ? error.message : 'unknown',
        },
      })
    }
  }

  return { chatted, emailed }
}

/** Posts into the organiser's direct conversation with one attendee. */
async function sendDirectMessage(
  actor: SessionActor,
  otherUserId: string,
  body: string,
): Promise<void> {
  const key = directMessageKey(actor.id, otherUserId)

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(channels)
      .values({
        orgId: actor.orgId,
        kind: 'direct',
        name: null,
        dmKey: key,
        createdByUserId: actor.id,
      })
      .onConflictDoNothing({ target: [channels.orgId, channels.dmKey] })
      .returning({ id: channels.id })

    const channelId =
      inserted[0]?.id ??
      (
        await tx
          .select({ id: channels.id })
          .from(channels)
          .where(and(inOrg(channels, actor), eq(channels.dmKey, key)))
          .limit(1)
      )[0]!.id

    await tx
      .insert(channelMembers)
      .values([
        { channelId, userId: actor.id },
        { channelId, userId: otherUserId },
      ])
      .onConflictDoNothing()

    await tx.insert(messages).values({
      orgId: actor.orgId,
      channelId,
      authorUserId: actor.id,
      authorName: actor.fullName,
      body,
    })
  })
}
