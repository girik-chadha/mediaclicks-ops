import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { oneOf } from './_sql'
import { meetings } from './meetings'
import { organisations } from './org'
import { users } from './users'

/**
 * Change requests that need someone else's yes (§4.6, ADR 0008).
 *
 * The rule: permission decides the path. Someone who may already make the
 * change makes it — the assistant stages it, they confirm, it happens.
 * Someone who may not does not get a refusal; they get to *ask*, and the
 * request lands with a person who may.
 *
 * That keeps the guarantee intact rather than bending it. The change is
 * always performed under the authority of someone entitled to perform it,
 * so nobody acquires a permission by asking nicely — they acquire a
 * conversation.
 */

export const APPROVAL_KIND = ['reschedule', 'cancel', 'reassign'] as const
export type ApprovalKind = (typeof APPROVAL_KIND)[number]

export const APPROVAL_STATUS = ['pending', 'approved', 'denied', 'withdrawn'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number]

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    /** SET NULL like audit — who asked must outlive the account (ADR 0003). */
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    requestedByName: text('requested_by_name').notNull(),

    /** The person who may actually make this change. */
    approverUserId: uuid('approver_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Cascade: a deleted meeting has nothing left to approve. */
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),

    kind: text('kind', { enum: APPROVAL_KIND }).notNull(),

    /**
     * The staged action's inputs, verbatim. Stored rather than recomputed so
     * that approving does exactly what was asked for, not what the same
     * sentence would mean a day later.
     */
    payload: jsonb('payload').$type<Record<string, string>>().notNull(),

    /** The sentence both people read. Frozen at request time for the same
     *  reason as the payload. */
    summary: text('summary').notNull(),

    status: text('status', { enum: APPROVAL_STATUS }).notNull().default('pending'),

    /** Why it was turned down, if the approver said. */
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The two queries that exist: what is waiting on me, and what did I ask
    // for. Both filter on status, so it leads the index.
    index('approvals_approver_idx').on(t.approverUserId, t.status),
    index('approvals_requester_idx').on(t.requestedByUserId, t.status),
    index('approvals_meeting_idx').on(t.meetingId),
    check('approvals_kind_valid', oneOf(t.kind, APPROVAL_KIND)),
    check('approvals_status_valid', oneOf(t.status, APPROVAL_STATUS)),
    // A decision has a time, and a pending request has not been decided.
    // Two halves of one fact, so the database holds them together.
    check(
      'approvals_decided_consistent',
      sql`(${t.status} = 'pending' AND ${t.decidedAt} IS NULL)
       OR (${t.status} <> 'pending' AND ${t.decidedAt} IS NOT NULL)`,
    ),
  ],
)
