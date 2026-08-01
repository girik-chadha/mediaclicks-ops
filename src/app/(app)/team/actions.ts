'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { hashPassword } from '@/server/auth/password'
import { requirePermission } from '@/server/auth/require'
import { db } from '@/server/db'
import { auditLog, roles, userRoles, users } from '@/server/db/schema'

export interface CreateUserState {
  error?: string
  created?: string
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
  } catch {
    return { error: 'That account could not be created. Try again.' }
  }

  revalidatePath('/team')
  return { created: email }
}
