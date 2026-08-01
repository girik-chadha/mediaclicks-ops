import 'server-only'
import { and, desc, eq, gte, lt, ne } from 'drizzle-orm'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import { auditLog, clients, meetings, users } from '../db/schema'
import { inOrg } from '../scope'

export interface ActivityItem {
  id: string
  initials: string
  who: string
  when: Date
  what: string
  where: string
}

const ACTION_PHRASE: Record<string, string> = {
  'meeting.created': 'scheduled',
  'meeting.updated': 'changed',
  'meeting.cancelled': 'cancelled',
  'user.created': 'added',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/**
 * "Since you were last here" (design §Home).
 *
 * The design fills this section from team chat, which is out of scope. The
 * audit log is the honest equivalent already in the schema: real events,
 * already org-scoped, already attributed. No invented activity.
 */
export async function listRecentActivity(
  actor: SessionActor,
  limit = 6,
): Promise<ActivityItem[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      after: auditLog.after,
      actorEmail: auditLog.actorEmail,
      createdAt: auditLog.createdAt,
      actorName: users.fullName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(inOrg(auditLog, actor))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)

  return rows.map((row) => {
    // actorName is null once the account is gone; actorEmail is denormalised
    // for exactly this case (ADR 0003).
    const who = row.actorName ?? row.actorEmail ?? 'Someone'
    const verb = ACTION_PHRASE[row.action] ?? row.action
    const subject =
      row.after && typeof row.after === 'object' && 'title' in row.after
        ? String((row.after as Record<string, unknown>).title)
        : row.after && typeof row.after === 'object' && 'email' in row.after
          ? String((row.after as Record<string, unknown>).email)
          : row.entityType

    return {
      id: row.id,
      initials: initialsOf(who),
      who,
      when: row.createdAt,
      what: `${verb} ${subject}`,
      where: row.entityType.toUpperCase(),
    }
  })
}

export interface ClientWeekItem {
  id: string
  name: string
  region: string
  count: number
}

/** "Clients this week" — how many meetings each client has in the window. */
export async function listClientsThisWeek(
  actor: SessionActor,
  from: Date,
  to: Date,
): Promise<ClientWeekItem[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.companyName,
      region: clients.region,
      meetingId: meetings.id,
    })
    .from(clients)
    .leftJoin(
      meetings,
      and(
        eq(meetings.clientId, clients.id),
        gte(meetings.startsAt, from),
        lt(meetings.startsAt, to),
        ne(meetings.status, 'cancelled'),
      ),
    )
    .where(inOrg(clients, actor))

  const byClient = new Map<string, ClientWeekItem>()
  for (const row of rows) {
    const existing = byClient.get(row.id)
    if (existing) {
      if (row.meetingId) existing.count += 1
    } else {
      byClient.set(row.id, {
        id: row.id,
        name: row.name,
        region: row.region,
        count: row.meetingId ? 1 : 0,
      })
    }
  }

  return [...byClient.values()].sort((a, b) => b.count - a.count).slice(0, 4)
}
