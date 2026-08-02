import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { normaliseChannelName } from '@/lib/chat/keys'
import { requireActor, type SessionActor } from '../auth/session'
import { db } from '../db'
import { channelMembers, channels, directMessageKey, messages, users } from '../db/schema'
import { inOrg } from '../scope'
import { isMember } from './queries'

export class NotAMemberError extends Error {
  override readonly name = 'NotAMemberError'
  constructor() {
    super('You are not in that conversation.')
  }
}

export async function createChannel(name: string, isPrivate = false): Promise<string> {
  const actor = await requireActor()
  const normalised = normaliseChannelName(name)
  if (!normalised) throw new Error('Give the channel a name.')

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(and(inOrg(channels, actor), eq(channels.name, normalised)))
      .limit(1)

    // Joining rather than failing: someone typing a name that already exists
    // wants that channel, not an error.
    if (existing[0]) {
      await tx
        .insert(channelMembers)
        .values({ channelId: existing[0].id, userId: actor.id })
        .onConflictDoNothing()
      return existing[0].id
    }

    const [created] = await tx
      .insert(channels)
      .values({
        orgId: actor.orgId,
        kind: 'channel',
        name: normalised,
        isPrivate,
        createdByUserId: actor.id,
      })
      .returning({ id: channels.id })

    await tx.insert(channelMembers).values({ channelId: created!.id, userId: actor.id })
    return created!.id
  })
}

/**
 * Finds or creates the direct conversation between the actor and someone else.
 *
 * Keyed on the sorted pair, so two people opening it simultaneously converge
 * on one channel instead of creating two histories. The unique index is the
 * guarantee; `onConflictDoNothing` plus a re-read is how the loser of that
 * race recovers.
 */
export async function openDirectMessage(otherUserId: string): Promise<string> {
  const actor = await requireActor()
  if (otherUserId === actor.id) throw new Error('You cannot message yourself.')

  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inOrg(users, actor), eq(users.id, otherUserId)))
    .limit(1)

  if (!other) throw new Error('That person is not in this organisation.')

  const key = directMessageKey(actor.id, otherUserId)

  return db.transaction(async (tx) => {
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

    return channelId
  })
}

export async function joinChannel(channelId: string): Promise<void> {
  const actor = await requireActor()

  const [channel] = await db
    .select({ id: channels.id, isPrivate: channels.isPrivate, kind: channels.kind })
    .from(channels)
    .where(and(inOrg(channels, actor), eq(channels.id, channelId)))
    .limit(1)

  if (!channel || channel.kind !== 'channel' || channel.isPrivate) {
    throw new NotAMemberError()
  }

  await db
    .insert(channelMembers)
    .values({ channelId, userId: actor.id })
    .onConflictDoNothing()
}

export async function sendMessage(channelId: string, body: string): Promise<void> {
  const actor = await requireActor()

  const trimmed = body.trim()
  if (!trimmed) throw new Error('Write something first.')
  if (trimmed.length > 4000) throw new Error('That message is too long.')

  // Membership is the authorisation for chat — §3's permission keys do not
  // cover it, and being in the conversation is the only meaningful gate.
  if (!(await isMember(actor, channelId))) throw new NotAMemberError()

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      orgId: actor.orgId,
      channelId,
      authorUserId: actor.id,
      // Denormalised so the message stays readable after the account is gone,
      // for the same reason audit rows carry actor_email (ADR 0003).
      authorName: actor.fullName,
      body: trimmed,
    })

    // Sending is reading: never leave your own message unread.
    await tx
      .update(channelMembers)
      .set({ lastReadAt: new Date() })
      .where(
        and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, actor.id)),
      )
  })
}

export async function markRead(channelId: string): Promise<void> {
  const actor = await requireActor()
  await db
    .update(channelMembers)
    .set({ lastReadAt: new Date() })
    .where(
      and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, actor.id)),
    )
}

/**
 * Refreshes presence, at most once a minute.
 *
 * Called from the app layout, so it costs one UPDATE per active user per
 * minute rather than one per request. The guard is in SQL so concurrent
 * requests cannot both decide they are the one to write.
 */
export async function touchPresence(actor: SessionActor): Promise<void> {
  await db
    .update(users)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(users.id, actor.id),
        sql`(${users.lastSeenAt} is null or ${users.lastSeenAt} < now() - interval '1 minute')`,
      ),
    )
}
