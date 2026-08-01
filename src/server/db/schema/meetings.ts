import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  ATTENDEE_RESPONSE,
  CONFERENCING_PROVIDER,
  MEETING_STATUS,
  MEETING_TYPE,
} from './enums'
import { oneOf } from './_sql'
import { clients } from './clients'
import { organisations } from './org'
import { users } from './users'

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),

    /** Stored UTC. Rendered in each viewer's timezone (§4.1). */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

    type: text('type', { enum: MEETING_TYPE }).notNull(),

    clientId: uuid('client_id').references(() => clients.id, {
      onDelete: 'restrict',
    }),

    /** RESTRICT: a meeting must always have an author. Users are deactivated,
     *  never hard-deleted — see users.deactivatedAt. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    conferencingProvider: text('conferencing_provider', {
      enum: CONFERENCING_PROVIDER,
    })
      .notNull()
      .default('none'),

    /** Null is a valid, expected state: WhatsApp and none generate no link,
     *  and a failed Meet/Zoom call still saves the meeting with a retry
     *  action rather than silently dropping it (§4.2). */
    conferenceUrl: text('conference_url'),
    conferenceExternalId: text('conference_external_id'),

    /** Kept from Phase 1 though §4.5 is deferred — transcript ingestion is
     *  rejected when false, and retrofitting consent onto recorded calls is
     *  not something you can do after the fact. */
    recordingConsentGiven: boolean('recording_consent_given')
      .notNull()
      .default(false),

    status: text('status', { enum: MEETING_STATUS })
      .notNull()
      .default('scheduled'),
  },
  (t) => [
    /** The calendar's hot path: every week/day view is a range scan of one
     *  org's meetings ordered by start time. */
    index('meetings_org_starts_idx').on(t.orgId, t.startsAt),

    check('meetings_type_valid', oneOf(t.type, MEETING_TYPE)),
    check('meetings_status_valid', oneOf(t.status, MEETING_STATUS)),
    check(
      'meetings_provider_valid',
      oneOf(t.conferencingProvider, CONFERENCING_PROVIDER),
    ),

    check('meetings_time_order', sql`${t.endsAt} > ${t.startsAt}`),

    /** §4.1.1 wants an invalid type/client combination to be unrepresentable.
     *  Zod enforces it at the API boundary; this enforces it for everything
     *  else — migrations, seeds, psql, a future service. */
    check(
      'meetings_client_link',
      sql`(${t.type} = 'client') = (${t.clientId} IS NOT NULL)`,
    ),
  ],
)

export const meetingAttendees = pgTable(
  'meeting_attendees',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    response: text('response', { enum: ATTENDEE_RESPONSE })
      .notNull()
      .default('pending'),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.userId] }),
    /** "My meetings" and the meeting.view.own ownership test both start here. */
    index('meeting_attendees_user_idx').on(t.userId),
    check('meeting_attendees_response_valid', oneOf(t.response, ATTENDEE_RESPONSE)),
  ],
)

/* ── Deferred (§4.5) ───────────────────────────────────────────────────────
   Created empty and unread. Kept because empty tables cost nothing and
   retrofitting them into a live schema does not.                          */

export const meetingTranscripts = pgTable(
  'meeting_transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Denormalised from meetings.org_id: §4.5's keyword search runs across
     *  transcripts directly, and that search must be org-scoped without
     *  depending on the caller remembering to join through meetings. */
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    rawText: text('raw_text').notNull(),
    provider: text('provider').notNull(),
    language: text('language'),
    durationSeconds: integer('duration_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meeting_transcripts_org_idx').on(t.orgId),
    index('meeting_transcripts_meeting_idx').on(t.meetingId),
  ],
)

export const meetingSummaries = pgTable(
  'meeting_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    tlDr: text('tl_dr').notNull(),
    keyPoints: jsonb('key_points').$type<string[]>().notNull().default([]),
    decisions: jsonb('decisions').$type<unknown[]>().notNull().default([]),
    actionItems: jsonb('action_items').$type<unknown[]>().notNull().default([]),
    clientRequests: jsonb('client_requests').$type<string[]>().notNull().default([]),
    modelUsed: text('model_used'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meeting_summaries_org_idx').on(t.orgId),
    index('meeting_summaries_meeting_idx').on(t.meetingId),
  ],
)
