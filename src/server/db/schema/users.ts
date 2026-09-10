import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
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

    /**
     * The name, in the two parts people actually edit.
     *
     * `last_name` is nullable because several real team members go by one
     * name and an empty-string sentinel is a lie the code then has to
     * remember to strip everywhere.
     */
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),

    /**
     * Derived by the database, not the application.
     *
     * Twenty files read `fullName`; none of them should care that it is now
     * two columns. A STORED generated column keeps every one of those reads
     * working unchanged, and makes drift impossible — there is no code path
     * that can write a full name disagreeing with its parts, because there
     * is no code path that can write it at all. Drizzle's insert type omits
     * it, so the compiler finds every write site rather than a 500 finding
     * it in production.
     */
    fullName: text('full_name')
      .notNull()
      .generatedAlwaysAs(
        sql`trim(both ' ' from (first_name || ' ' || coalesce(last_name, '')))`,
      ),
    avatarUrl: text('avatar_url'),
    phoneE164: text('phone_e164'),

    /**
     * IANA zone. All instants are stored UTC and rendered through this.
     *
     * The default is where the team actually is, because a wrong default is
     * not a cosmetic problem in a scheduling product — it renders every
     * meeting at the wrong time until someone notices and corrects it, and
     * "the app said 3pm" is how people miss calls. Anyone can override it on
     * their profile; this is only the starting point.
     */
    timezone: text('timezone').notNull().default('Asia/Kolkata'),

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

    /**
     * Notification preferences (§4.4).
     *
     * Stored now, consumed in Phase 3. The spec asks for a per-user digest
     * time and a per-user reminder lead, and a preference that is genuinely
     * saved is worth more than a toggle that pretends — when the workers
     * land they read these rather than needing everyone to set them again.
     */
    dailyDigest: boolean('daily_digest').notNull().default(true),
    /** Local wall-clock time, interpreted in the user's own timezone. */
    digestTime: text('digest_time').notNull().default('08:00'),
    reminderLeadMinutes: integer('reminder_lead_minutes').notNull().default(30),

    /**
     * Whether this person is asked for an emailed code at sign-in.
     *
     * Per person, not per organisation, and off by default. An agency of
     * five to twenty-five has no device policy and no help desk; forcing a
     * second step on everyone at once means the first person who cannot
     * reach their inbox has nobody to call. Opting in individually means the
     * blast radius of that is one account, and the people who turn it on are
     * the ones who understood what they were turning on.
     *
     * `AUTH_2FA=required` still exists and still overrides this for
     * everybody — see src/lib/auth/two-factor.ts. This is the default, not
     * the ceiling.
     */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),

    /**
     * When they last said "not now" to the offer on Home.
     *
     * A timestamp rather than a boolean because "dismissed" and "dismissed
     * in March" are different facts, and only one of them can be turned into
     * "ask again after a while" without a migration. Today any value at all
     * means never ask again — the X on that card says "not see it", and a
     * nudge that returns anyway is a nag that teaches people to ignore the
     * spot it appears in.
     */
    twoFactorPromptDismissedAt: timestamp('two_factor_prompt_dismissed_at', {
      withTimezone: true,
    }),
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
