import 'server-only'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import { approvalRequests, channelMembers, channels, messages, users } from '../db/schema'
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
  /**
   * Three queries, not one per conversation.
   *
   * This was an N+1: a membership query, then an unread count, a last-message
   * lookup and an "other member" lookup *for each row*. Ten conversations
   * meant thirty-one round trips, and at ~160ms each that is the difference
   * between a page appearing and a page arriving. Aggregating per channel and
   * folding in memory turns it into three.
   */
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

  const ids = rows.map((r) => r.id)

  const [stats, others] = await Promise.all([
    // Unread and last-message, per channel, in one grouped pass. The unread
    // comparison uses each membership's own last_read_at, joined rather than
    // looped.
    db
      .select({
        channelId: messages.channelId,
        unread: sql<number>`count(*) filter (
          where ${messages.authorUserId} is distinct from ${actor.id}
            and (${channelMembers.lastReadAt} is null
                 or ${messages.createdAt} > ${channelMembers.lastReadAt})
        )::int`,
        lastAt: sql<Date | null>`max(${messages.createdAt})`,
      })
      .from(messages)
      .innerJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, messages.channelId),
          eq(channelMembers.userId, actor.id),
        ),
      )
      .where(and(inArray(messages.channelId, ids), isNull(messages.deletedAt)))
      .groupBy(messages.channelId),

    // The other participant of every direct conversation, in one query.
    db
      .select({
        channelId: channelMembers.channelId,
        id: users.id,
        fullName: users.fullName,
        lastSeenAt: users.lastSeenAt,
      })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(
        and(inArray(channelMembers.channelId, ids), ne(channelMembers.userId, actor.id)),
      ),
  ])

  const statByChannel = new Map(stats.map((s) => [s.channelId, s]))
  const otherByChannel = new Map(others.map((o) => [o.channelId, o]))

  const summaries = rows.map((row) => {
    const stat = statByChannel.get(row.id)
    const other = row.kind === 'direct' ? otherByChannel.get(row.id) : undefined

    return {
      id: row.id,
      kind: row.kind,
      label: other?.fullName ?? row.name ?? 'Conversation',
      unread: stat?.unread ?? 0,
      otherUserId: other?.id ?? null,
      online: other ? isOnline(other.lastSeenAt) : false,
      lastMessageAt: stat?.lastAt ? new Date(stat.lastAt) : null,
    }
  })

  // Channels alphabetically, direct messages by recency — a channel list that
  // reorders itself as people talk is impossible to build muscle memory for,
  // whereas a DM list that does not surface recent conversations is useless.
  return summaries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1
    if (a.kind === 'channel') return a.label.localeCompare(b.label)
    return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)
  })
}

/**
 * Total unread across every conversation, in one query.
 *
 * The nav badge is the only thing the app layout needed from chat, and it was
 * paying for the entire conversation list — labels, presence, last-message
 * times — on every page, to render a number. This is that number.
 */
export async function countUnread(actor: SessionActor): Promise<number> {
  const [row] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, messages.channelId),
        eq(channelMembers.userId, actor.id),
      ),
    )
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(
      and(
        inOrg(channels, actor),
        isNull(channels.archivedAt),
        isNull(messages.deletedAt),
        ne(messages.authorUserId, actor.id),
        sql`(${channelMembers.lastReadAt} is null
             or ${messages.createdAt} > ${channelMembers.lastReadAt})`,
      ),
    )

  return row?.unread ?? 0
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
  /**
   * Present when this message is an approval request (ADR 0008). The
   * decision buttons only render for the person being asked — `canDecide`
   * is that check, made here where the session is, not in the browser.
   */
  approval?: {
    id: string
    status: string
    summary: string
    canDecide: boolean
  }
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
      approvalId: approvalRequests.id,
      approvalStatus: approvalRequests.status,
      approvalSummary: approvalRequests.summary,
      approverUserId: approvalRequests.approverUserId,
    })
    .from(messages)
    .leftJoin(approvalRequests, eq(approvalRequests.id, messages.approvalRequestId))
    .where(and(eq(messages.channelId, channelId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(limit)

  // Newest-first from the database so the index and LIMIT do the work;
  // oldest-first for reading.
  return rows.reverse().map(({ approvalId, approvalStatus, approvalSummary, approverUserId, ...m }) => ({
    ...m,
    mine: m.authorUserId === actor.id,
    ...(approvalId
      ? {
          approval: {
            id: approvalId,
            status: approvalStatus ?? 'pending',
            summary: approvalSummary ?? '',
            // Decided here, where the session is. A browser deciding who may
            // approve would be a suggestion, not a rule — and the server
            // action re-checks it anyway.
            canDecide: approverUserId === actor.id && approvalStatus === 'pending',
          },
        }
      : {}),
  }))
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
