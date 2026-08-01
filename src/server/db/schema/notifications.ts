import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE } from './enums'
import { oneOf } from './_sql'
import { meetings } from './meetings'
import { organisations } from './org'
import { users } from './users'

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Denormalised from users.org_id. Not redundant in practice: the sender
     *  worker drains across tenants and must be able to filter or shard by
     *  org without joining, and a forgotten join is a silent cross-tenant
     *  leak whereas a forgotten org filter is caught by the scope helper. */
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Added beyond spec §2, which lists no such column — but §4.4 mandates a
     * unique index on `user_id + type + meeting_id + scheduled_for`. The
     * idempotency guarantee is unimplementable without it.
     *
     * Null for daily_digest, which is not about one meeting. See the index
     * below for why that nullability needs care.
     */
    meetingId: uuid('meeting_id').references(() => meetings.id, {
      onDelete: 'cascade',
    }),

    type: text('type', { enum: NOTIFICATION_TYPE }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    channel: text('channel', { enum: NOTIFICATION_CHANNEL }).notNull(),

    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * §4.4's double-send guard. The constraint IS the guarantee — worker code
     * must be free to crash and restart at any point.
     *
     * NULLS NOT DISTINCT is load-bearing, not decoration. Postgres treats
     * every NULL as distinct in a unique index by default, so the plain
     * version silently enforces nothing for daily_digest rows (meeting_id is
     * null there) — precisely the case where a worker restart would
     * double-send. Requires Postgres 15+, which is our stated floor.
     */
    unique('notifications_idempotency_unq')
      .on(t.userId, t.type, t.meetingId, t.scheduledFor)
      .nullsNotDistinct(),

    /** The sender worker's drain query: due, unsent, oldest first. */
    index('notifications_pending_idx')
      .on(t.scheduledFor)
      .where(sql`${t.sentAt} IS NULL`),

    /** A user's own notification list, newest first. */
    index('notifications_user_idx').on(t.userId, t.scheduledFor),

    check('notifications_type_valid', oneOf(t.type, NOTIFICATION_TYPE)),
    check('notifications_channel_valid', oneOf(t.channel, NOTIFICATION_CHANNEL)),
  ],
)
