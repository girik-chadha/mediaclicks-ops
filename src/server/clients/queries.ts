import 'server-only'
import { and, asc, desc, eq, ne } from 'drizzle-orm'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import { clients, meetings } from '../db/schema'
import { inOrg } from '../scope'

export interface ClientRow {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phoneE164: string | null
  region: 'domestic' | 'international'
  preferredChannel: 'email' | 'whatsapp'
  notes: string | null
  meetingCount: number
}

export interface ClientHistoryItem {
  id: string
  title: string
  startsAt: Date
  status: 'scheduled' | 'cancelled' | 'completed'
  conferencingProvider: 'google_meet' | 'zoom' | 'whatsapp' | 'none'
}

/**
 * Every client with how many meetings it has on record.
 *
 * Two queries and a fold rather than a LEFT JOIN with a count: joining
 * inline returns a row per client × meeting, which is the same mistake the
 * team roster made when it counted rows instead of people.
 */
export async function listClients(actor: SessionActor): Promise<ClientRow[]> {
  const rows = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      email: clients.email,
      phoneE164: clients.phoneE164,
      region: clients.region,
      preferredChannel: clients.preferredChannel,
      notes: clients.notes,
    })
    .from(clients)
    .where(inOrg(clients, actor))
    .orderBy(asc(clients.companyName))

  if (rows.length === 0) return []

  const counts = await db
    .select({ clientId: meetings.clientId })
    .from(meetings)
    .where(and(inOrg(meetings, actor), ne(meetings.status, 'cancelled')))

  const byClient = new Map<string, number>()
  for (const m of counts) {
    if (m.clientId) byClient.set(m.clientId, (byClient.get(m.clientId) ?? 0) + 1)
  }

  return rows.map((c) => ({ ...c, meetingCount: byClient.get(c.id) ?? 0 }))
}

/** Newest first — the panel shows what happened most recently. */
export async function listClientHistory(
  actor: SessionActor,
  clientId: string,
  limit = 12,
): Promise<ClientHistoryItem[]> {
  return db
    .select({
      id: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
      status: meetings.status,
      conferencingProvider: meetings.conferencingProvider,
    })
    .from(meetings)
    .where(and(inOrg(meetings, actor), eq(meetings.clientId, clientId)))
    .orderBy(desc(meetings.startsAt))
    .limit(limit)
}
