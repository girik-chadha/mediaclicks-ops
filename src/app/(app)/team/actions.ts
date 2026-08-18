'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { reportUnexpected } from '@/server/report'
import { z } from 'zod'
import { hashPassword } from '@/server/auth/password'
import { requirePermission } from '@/server/auth/require'
import { db } from '@/server/db'
import {
  auditLog,
  channelMembers,
  channels,
  roles,
  userRoles,
  users,
} from '@/server/db/schema'

export interface CreateUserState {
  error?: string
  created?: string
}

/**
 * Role changes. Gated on user.manage, which §3 gives to Owner only — so a
 * Manager can add people but cannot promote them, including themselves.
 */
export async function setUserRoleAction(
  userId: string,
  roleName: string,
): Promise<{ error?: string }> {
  try {
    const { setUserRole } = await import('@/server/team/mutations')
    await setUserRole(userId, roleName)
  } catch (error) {
    if (error instanceof Error) {
      // ForbiddenError and LastOwnerError both carry a sentence already
      // written in the product's voice.
      if (error.name === 'ForbiddenError' || error.name === 'LastOwnerError') {
        return { error: error.message }
      }
      return { error: 'That change did not save. Try again.' }
    }
    throw error
  }

  revalidatePath('/team')
  return {}
}

const input = z.object({
  fullName: z.string().trim().min(1, 'Enter a name.').max(200),
  email: z.string().trim().toLowerCase().min(3).max(320).includes('@', {
    message: 'Enter a valid email address.',
  }),
  password: z.string().min(12, 'The initial password must be at least 12 characters.').max(1024),
})

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  // Authorization first, before reading anything. Throws ForbiddenError,
  // caught by the route's error boundary. The UI hiding the Team link is
  // presentation; this is the enforcement (§3).
  const actor = await requirePermission('user.invite')

  const parsed = input.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  const { fullName, email, password } = parsed.data

  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (taken.length > 0) {
    return { error: `${email} already has an account.` }
  }

  // Every new person starts as a Member. Changing that is role.manage, a
  // separate permission and a separate screen.
  const memberRole = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.orgId, actor.orgId), eq(roles.name, 'Member')))
    .limit(1)

  const roleId = memberRole[0]?.id
  if (!roleId) {
    return { error: 'The Member role is missing. Run the seed script.' }
  }

  const passwordHash = await hashPassword(password)

  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({ orgId: actor.orgId, email, fullName, passwordHash })
        .returning({ id: users.id })

      const newUserId = inserted[0]!.id

      await tx.insert(userRoles).values({ userId: newUserId, roleId })

      // Join every open channel. Someone who joins the company is already in
      // the room — making them hunt for #general on day one is a chore that
      // exists only because the software forgot to do it.
      const open = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.orgId, actor.orgId),
            eq(channels.kind, 'channel'),
            eq(channels.isPrivate, false),
            isNull(channels.archivedAt),
          ),
        )

      if (open.length > 0) {
        await tx
          .insert(channelMembers)
          .values(open.map((c) => ({ channelId: c.id, userId: newUserId })))
          .onConflictDoNothing()
      }

      // Written in the same transaction as the change it describes, so the
      // two commit together or not at all (ADR 0003).
      await tx.insert(auditLog).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        actorEmail: actor.email,
        action: 'user.created',
        entityType: 'user',
        entityId: newUserId,
        before: null,
        // Never the password hash. An audit log is read by people.
        after: { email, fullName, roles: ['Member'] },
      })
    })
  } catch (error) {
    reportUnexpected('team action', error)
    return { error: 'That account could not be created. Try again.' }
  }

  revalidatePath('/team')
  return { created: email }
}

/* ── Custom roles (§3) ─────────────────────────────────────────────────
   The permission vocabulary is fixed in code; roles are the per-org
   bundles of it, so an agency can name the ones it actually has — GFX,
   VFX, Editor — instead of bending everyone into Owner/Manager/Member.
   All four are gated on `role.manage` inside the mutation layer.        */

export interface RoleFormState {
  error?: string
  saved?: string
}

/** Every error these can raise is already written for a person to read. */
function roleMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const named = [
      'ForbiddenError',
      'RoleInUseError',
      'SystemRoleError',
      'DuplicateRoleError',
    ]
    if (named.includes(error.name)) return error.message
    // The mutations throw plain Errors with reader-ready sentences for the
    // last-owner and last-admin guards; length is the only signal that a
    // message was written rather than thrown by a driver.
    if (error.message && error.message.length < 160) return error.message
  }
  reportUnexpected('role action', error)
  return fallback
}

function revalidateTeam(): void {
  revalidatePath('/team')
  // A permission change alters what every screen offers, and the nav hides
  // Team itself from anyone without user.invite.
  revalidatePath('/calendar')
  revalidatePath('/clients')
  revalidatePath('/home')
}

export async function createRoleAction(
  _prev: RoleFormState,
  form: FormData,
): Promise<RoleFormState> {
  const name = String(form.get('name') ?? '')
  const keys = form.getAll('permissionKeys').map(String)

  try {
    const { createRole } = await import('@/server/team/roles')
    await createRole(name, keys)
  } catch (error) {
    return { error: roleMessage(error, 'That role could not be created.') }
  }

  revalidateTeam()
  return { saved: name.trim() }
}

export async function setRolePermissionsAction(
  _prev: RoleFormState,
  form: FormData,
): Promise<RoleFormState> {
  const roleId = String(form.get('roleId') ?? '')
  const keys = form.getAll('permissionKeys').map(String)

  try {
    const { setRolePermissions } = await import('@/server/team/roles')
    await setRolePermissions(roleId, keys)
  } catch (error) {
    return { error: roleMessage(error, 'Those permissions could not be saved.') }
  }

  revalidateTeam()
  return { saved: 'Permissions updated' }
}

export async function renameRoleAction(
  roleId: string,
  name: string,
): Promise<RoleFormState> {
  try {
    const { renameRole } = await import('@/server/team/roles')
    await renameRole(roleId, name)
  } catch (error) {
    return { error: roleMessage(error, 'That role could not be renamed.') }
  }

  revalidateTeam()
  return { saved: name.trim() }
}

export async function deleteRoleAction(roleId: string): Promise<RoleFormState> {
  try {
    const { deleteRole } = await import('@/server/team/roles')
    await deleteRole(roleId)
  } catch (error) {
    return { error: roleMessage(error, 'That role could not be removed.') }
  }

  revalidateTeam()
  return { saved: 'Role removed' }
}
