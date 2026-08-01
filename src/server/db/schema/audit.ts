import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organisations } from './org'
import { users } from './users'

/**
 * Written by the application, not a database trigger.
 * See docs/adr/0003-audit-log-as-application-table.md.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    /**
     * SET NULL, not CASCADE. The record of what happened must outlive the
     * account that did it — cascading here would let deleting a user quietly
     * erase the evidence of what they did, which is the one thing an audit
     * log exists to prevent.
     */
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /**
     * Denormalised at write time so the row stays meaningful after
     * actor_user_id goes null. An audit entry reading "someone did this" is
     * not an audit entry. Audit records must be self-contained because they
     * outlive the rows they reference.
     */
    actorEmail: text('actor_email'),

    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),

    /** jsonb, not json: the diff is queried (which fields changed, what a
     *  value was on a date), and jsonb is the only one that can be indexed
     *  and operated on. Null on create/delete respectively. */
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),

    /** §4.6: agent-initiated actions carry the human as actor, plus this
     *  flag, so "the assistant did it on my behalf" stays distinguishable
     *  from "I clicked it". */
    agentInitiated: boolean('agent_initiated').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_org_created_idx').on(t.orgId, t.createdAt),
    index('audit_entity_idx').on(t.entityType, t.entityId),
  ],
)
