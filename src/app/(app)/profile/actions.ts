'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/server/auth/session'
import { db } from '@/server/db'
import { auditLog, users } from '@/server/db/schema'

export interface ProfileState {
  error?: string
  saved?: boolean
}

const input = z.object({
  fullName: z.string().trim().min(1, 'Your name cannot be blank.').max(200),
  phoneE164: z.string().trim().max(32).optional(),
  timezone: z.string().trim().min(1).max(64),
  dailyDigest: z.boolean(),
  /** Wall-clock HH:mm, read in the user's own zone (§4.4). */
  digestTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Digest time must be a time of day.'),
  reminderLeadMinutes: z.coerce.number().int().min(5).max(240),
})

/** Rejects a zone Intl cannot resolve, rather than storing something that
 *  makes every rendered time silently wrong. */
function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export async function updateProfileAction(
  _prev: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  // No permission key here: everyone may edit their own profile, and it is
  // scoped to the session's own id, so there is nothing to authorise beyond
  // being signed in.
  const actor = await requireActor()

  const parsed = input.safeParse({
    fullName: form.get('fullName'),
    phoneE164: form.get('phoneE164') || undefined,
    timezone: form.get('timezone'),
    // An unchecked checkbox sends nothing at all, so absence is false.
    dailyDigest: form.get('dailyDigest') === 'on',
    digestTime: form.get('digestTime'),
    reminderLeadMinutes: form.get('reminderLeadMinutes'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  if (!isValidZone(parsed.data.timezone)) {
    return { error: 'That is not a timezone this browser recognises.' }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        phoneE164: parsed.data.phoneE164 ?? null,
        timezone: parsed.data.timezone,
        dailyDigest: parsed.data.dailyDigest,
        digestTime: parsed.data.digestTime,
        reminderLeadMinutes: parsed.data.reminderLeadMinutes,
      })
      .where(eq(users.id, actor.id))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'user.profile_updated',
      entityType: 'user',
      entityId: actor.id,
      before: { fullName: actor.fullName, timezone: actor.timezone },
      after: {
        fullName: parsed.data.fullName,
        timezone: parsed.data.timezone,
        dailyDigest: parsed.data.dailyDigest,
        digestTime: parsed.data.digestTime,
        reminderLeadMinutes: parsed.data.reminderLeadMinutes,
      },
    })
  })

  // The zone changes how every timestamp renders, so refresh the screens that
  // show them rather than only this one.
  revalidatePath('/profile')
  revalidatePath('/home')
  revalidatePath('/today')
  revalidatePath('/calendar')

  return { saved: true }
}
