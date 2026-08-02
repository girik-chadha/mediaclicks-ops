import 'server-only'
import { and, asc, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import { channelMembers, channels, messages, users } from '../db/schema'
import { inOrg } from '../scope'

/** Someone is "online" if they have been seen in the last five minutes. */
export const PRESENCE_WINDOW_MS = 5 * 60_000

export interface ConversationSummary {
  id: string
  kind: 'channel' | 'direct'
  /** `#creative` for channels, the other person's name for a direct message. */
  label: string
  unread: number
  /** Direct messages only. */
  otherUserId: string | null
  online: boolean
  lastMessageAt: Date | null
}

/**
 * Every conversation the actor is a member of, with unread counts.
 *
 * Unread is a comparison against `last_read_at`, not a count of receipt rows.
 * Receipts would grow with messages × members and turn "how many unread" into
 * a scan; this is one indexed count per channel.
 */
export async function listConversations(
  actor: SessionActor,
): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: channels.id,
      kind: channels.kind,
      name: channels.name,
      lastReadAt: channelMembers.lastReadAt,
    })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.userId, actor.id),
        inOrg(channels, actor),
        isNull(channels.archivedAt),
      ),
    )

  if (rows.length === 0) return []

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const [{ unread = 0 } = { unread: 0 }] = await db
        .select({ unread: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.channelId, row.id),
            isNull(messages.deletedAt),
            ne(messages.authorUserId, actor.id),
            row.lastReadAt ? gt(messages.createdAt, row.lastReadAt) : sql`true`,
          ),
        )

      const [latest] = await db
        .select({ at: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.channelId, row.id), isNull(messages.deletedAt)))
        .orderBy(desc(messages.createdAt))
        .limit(1)

      let label = row.name ?? 'Conversation'
      let otherUserId: string | null = null
      let online = false

      if (row.kind === 'direct') {
        const [other] = await db
          .select({
            id: users.id,
            fullName: users.fullName,
            lastSeenAt: users.lastSeenAt,
          })
          .from(channelMembers)
          .innerJoin(users, eq(users.id, channelMembers.userId))
          .where(
            and(eq(channelMembers.channelId, row.id), ne(channelMembers.userId, actor.id)),
          )
          .limit(1)

        if (other) {
          label = other.fullName
          otherUserId = other.id
          online = isOnline(other.lastSeenAt)
        }
      }

      return {
        id: row.id,
        kind: row.kind,
        label,
        unread,
        otherUserId,
        online,
        lastMessageAt: latest?.at ?? null,
      }
    }),
  )

  // Channels alphabetically, direct messages by recency — a channel list that
  // reorders itself as people talk is impossible to build muscle memory for,
  // whereas a DM list that does not surface recent conversations is useless.
  return summaries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1
    if (a.kind === 'channel') return a.label.localeCompare(b.label)
    return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)
  })
}

export function isOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false
  return Date.now() - lastSeenAt.getTime() < PRESENCE_WINDOW_MS
}

export interface ChatMessage {
  id: string
  authorUserId: string | null
  authorName: string
  body: string
  createdAt: Date
  editedAt: Date | null
  mine: boolean
}

/** Refuses to return anything for a channel the actor is not a member of. */
export async function isMember(actor: SessionActor, channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, actor.id),
        inOrg(channels, actor),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function listMessages(
  actor: SessionActor,
  channelId: string,
  limit = 100,
): Promise<ChatMessage[]> {
  if (!(await isMember(actor, channelId))) return []

  const rows = await db
    .select({
      id: messages.id,
      authorUserId: messages.authorUserId,
      authorName: messages.authorName,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
    })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(limit)

  // Newest-first from the database so the index and LIMIT do the work;
  // oldest-first for reading.
  return rows.reverse().map((m) => ({ ...m, mine: m.authorUserId === actor.id }))
}

/** Channels in the org the actor has not joined, so they can be discovered. */
export async function listJoinableChannels(actor: SessionActor) {
  const mine = db
    .select({ id: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, actor.id))

  return db
    .select({ id: channels.id, name: channels.name })
    .from(channels)
    .where(
      and(
        inOrg(channels, actor),
        eq(channels.kind, 'channel'),
        eq(channels.isPrivate, false),
        isNull(channels.archivedAt),
        sql`${channels.id} not in ${mine}`,
      ),
    )
    .orderBy(asc(channels.name))
}

/** Everyone else in the org, for starting a direct message. */
export async function listChattablePeople(actor: SessionActor) {
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(and(inOrg(users, actor), ne(users.id, actor.id), isNull(users.deactivatedAt)))
    .orderBy(asc(users.fullName))
}

export { or }
