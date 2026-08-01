import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organisations } from './org'
import { users } from './users'

/**
 * Roles are per-organisation, so the Owner can define custom ones from the UI
 * (§3). `is_system_role` marks the three seeded bundles, which the UI refuses
 * to delete.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isSystemRole: boolean('is_system_role').notNull().default(false),
  },
  (t) => [uniqueIndex('roles_org_name_unq').on(t.orgId, t.name)],
)

/**
 * No `org_id`. Permission keys are global constants shipped with the code —
 * the set is identical for every tenant. Roles are the per-org bundles.
 * Putting org_id here would imply an org can invent a permission key, which
 * would mean inventing the code that enforces it.
 */
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
})

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    // Session load resolves a user's full permission set on every request.
    index('user_roles_user_idx').on(t.userId),
  ],
)
