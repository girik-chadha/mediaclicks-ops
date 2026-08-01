/**
 * Seeds the permission vocabulary, the three system roles, and the day-one
 * Owner (§3, §8).
 *
 * Idempotent — safe to re-run. Re-running after a permission key is added
 * reconciles the system-role bundles, which is the point: the bundles are
 * defined in code and the table is a projection of them.
 *
 *   npm run db:seed
 *
 * Builds its own connection rather than importing `@/server/db`, which is
 * marked `server-only` and would throw outside a React Server Component.
 */
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { hashPassword } from '../auth/password'
import {
  PERMISSION_KEYS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRoleName,
} from '../../lib/permissions'
import * as schema from './schema'
import { organisations, permissions, rolePermissions, roles, userRoles, users } from './schema'

config({ path: '.env.local' })
config({ path: '.env' })

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required to seed. See .env.example.`)
  return value
}

async function main() {
  const databaseUrl = required('DATABASE_URL')
  const orgName = process.env.SEED_ORG_NAME ?? 'MediaClicks'
  const ownerEmail = required('SEED_OWNER_EMAIL').toLowerCase()
  const ownerName = process.env.SEED_OWNER_NAME ?? 'Owner'
  const ownerPassword = required('SEED_OWNER_PASSWORD')

  if (ownerPassword.length < 12) {
    throw new Error('SEED_OWNER_PASSWORD must be at least 12 characters.')
  }

  const client = postgres(databaseUrl, { max: 1 })
  const db = drizzle(client, { schema })

  try {
    await db.transaction(async (tx) => {
      // ── 1. Permission vocabulary ──────────────────────────────────────
      await tx
        .insert(permissions)
        .values(PERMISSION_KEYS.map((key) => ({ key })))
        .onConflictDoNothing({ target: permissions.key })

      const permRows = await tx
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, [...PERMISSION_KEYS]))

      const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]))
      if (permIdByKey.size !== PERMISSION_KEYS.length) {
        throw new Error('Permission rows did not reconcile with PERMISSION_KEYS.')
      }

      // ── 2. Organisation ───────────────────────────────────────────────
      const existingOrg = await tx
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.name, orgName))
        .limit(1)

      const orgId =
        existingOrg[0]?.id ??
        (
          await tx
            .insert(organisations)
            .values({ name: orgName })
            .returning({ id: organisations.id })
        )[0]!.id

      // ── 3. System roles, and their bundles ────────────────────────────
      const roleIdByName = new Map<SystemRoleName, string>()

      for (const name of SYSTEM_ROLE_NAMES) {
        const existing = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.orgId, orgId), eq(roles.name, name)))
          .limit(1)

        const roleId =
          existing[0]?.id ??
          (
            await tx
              .insert(roles)
              .values({ orgId, name, isSystemRole: true })
              .returning({ id: roles.id })
          )[0]!.id

        roleIdByName.set(name, roleId)

        // Reconcile rather than append: the bundle is defined in code, so
        // removing a key from SYSTEM_ROLE_PERMISSIONS must revoke it here.
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
        await tx.insert(rolePermissions).values(
          SYSTEM_ROLE_PERMISSIONS[name].map((key) => ({
            roleId,
            permissionId: permIdByKey.get(key)!,
          })),
        )
      }

      // ── 4. Day-one Owner ──────────────────────────────────────────────
      const existingUser = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, ownerEmail))
        .limit(1)

      let ownerId = existingUser[0]?.id
      let created = false

      if (!ownerId) {
        const passwordHash = await hashPassword(ownerPassword)
        ownerId = (
          await tx
            .insert(users)
            .values({ orgId, email: ownerEmail, fullName: ownerName, passwordHash })
            .returning({ id: users.id })
        )[0]!.id
        created = true
      }

      await tx
        .insert(userRoles)
        .values({ userId: ownerId, roleId: roleIdByName.get('Owner')! })
        .onConflictDoNothing()

      console.log(`org        ${orgName} (${orgId})`)
      console.log(`permissions ${PERMISSION_KEYS.length} reconciled`)
      for (const name of SYSTEM_ROLE_NAMES) {
        console.log(`role       ${name.padEnd(8)} ${SYSTEM_ROLE_PERMISSIONS[name].length} permissions`)
      }
      console.log(
        `owner      ${ownerEmail} ${created ? '(created)' : '(existed, password unchanged)'}`,
      )
    })
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
