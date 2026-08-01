import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * The tenant boundary. Every table holding user data carries `org_id` and
 * every query filters on it — see docs/adr/0004-tenant-isolation.md.
 */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
