import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { approvalRequests } from './approvals'
import { oneOf } from './_sql'
import { organisations } from './org'
import { users } from './users'

/**
 * Team chat.
 *
 * Not in spec §2 — it arrived through the design and was confirmed as wanted.
 * The shape follows the same rules as the rest of the schema: text + CHECK
 * rather than native enums (ADR 0002), org_id on every first-class entity
 * (ADR 0004), and soft delete where a record has to outlive its subject.
 */

export const CHANNEL_KIND = ['channel', 'direct'] as const
export type ChannelKind = (typeof CHANNEL_KIND)[number]

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    kind: text('kind', { enum: CHANNEL_KIND }).notNull(),

    /** Null for direct messages — their name is whoever you are talking to. */
    name: text('name'),

    /**
     * The two participants of a direct conversation, as sorted ids joined by
     * a colon. Unique per org, which is what stops two people opening the
     * same conversation twice and ending up with divergent histories — a
     * genuine hazard when both click "message Omar" within a second of each
     * other. Sorting makes it order-independent.
     */
    dmKey: text('dm_key'),

    isPrivate: boolean('is_private').notNull().default(false),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('channels_org_idx').on(t.orgId),
    uniqueIndex('channels_dm_key_unq').on(t.orgId, t.dmKey),
    uniqueIndex('channels_org_name_unq')
      .on(t.orgId, t.name)
      .where(sql`${t.kind} = 'channel'`),
    check('channels_kind_valid', oneOf(t.kind, CHANNEL_KIND)),
    // A named channel has no dm_key; a direct conversation has no name.
    // The two shapes are mutually exclusive and the database says so.
    check(
      'channels_shape',
      sql`(${t.kind} = 'channel' AND ${t.name} IS NOT NULL AND ${t.dmKey} IS NULL)
       OR (${t.kind} = 'direct'  AND ${t.name} IS NULL     AND ${t.dmKey} IS NOT NULL)`,
    ),
  ],
)

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Unread counts are derived from this rather than stored per message.
     * A read-receipt row per member per message is the obvious design and
     * the wrong one: it grows with messages × members, and answering "how
     * many unread" then means counting rows instead of comparing one
     * timestamp.
     */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('channel_members_user_idx').on(t.userId),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),

    /** SET NULL, like audit: the message survives the account (ADR 0003). */
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    authorName: text('author_name').notNull(),

    body: text('body').notNull(),

    /**
     * Set when this message *is* an approval request, so the chat renders
     * Accept and Deny on it rather than plain text.
     *
     * The link lives here rather than on the request because a message is
     * the thing being rendered, and a join from the other side would mean
     * every channel read paying for a table most messages never touch.
     */
    approvalRequestId: uuid('approval_request_id').references(
      () => approvalRequests.id,
      { onDelete: 'set null' },
    ),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** Soft delete: a removed message leaves a gap, not a rewritten history. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The only query that matters: one channel, newest first, paged.
    index('messages_channel_created_idx').on(t.channelId, t.createdAt),
    index('messages_org_idx').on(t.orgId),
    check('messages_body_not_empty', sql`length(btrim(${t.body})) > 0`),
  ],
)


// Re-exported so callers can reach it from the schema module they already use.
export { directMessageKey } from '@/lib/chat/keys'
