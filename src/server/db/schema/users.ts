import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { organisations } from './org'

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    email: text('email').notNull(),

    /** Nullable: an OAuth-only account (Phase 4) has no password. Making this
     *  NOT NULL now would force a migration the moment Google sign-in lands. */
    passwordHash: text('password_hash'),

    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    phoneE164: text('phone_e164'),

    /** IANA zone. All instants are stored UTC and rendered through this. */
    timezone: text('timezone').notNull().default('Asia/Dubai'),

    /**
     * Soft delete. People leave agencies, but `meetings.created_by_user_id`
     * is ON DELETE RESTRICT because a meeting must always have an author —
     * so a user who has ever created one could never be hard-deleted.
     * Deactivation is the supported path; rows are never destroyed.
     * Also protects audit integrity: see docs/adr/0004-tenant-isolation.md.
     */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    /**
     * Presence, refreshed at most once a minute. The design shows a dot beside
     * each person in chat, and the honest alternatives were a websocket we do
     * not need yet or a fake dot — a presence indicator that is decorative is
     * worse than none, because people rely on it.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * Globally unique, not unique per organisation. Credentials sign-in
     * resolves an account from an email alone, so scoping uniqueness to the
     * org would make that lookup ambiguous. Cost: one person cannot belong to
     * two organisations. Correct for a single-agency internal tool.
     */
    uniqueIndex('users_email_unq').on(t.email),
    index('users_org_idx').on(t.orgId),
  ],
)
