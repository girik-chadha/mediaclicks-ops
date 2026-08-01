import 'server-only'
import { z } from 'zod'
import { requirePermission } from '../auth/require'
import { db } from '../db'
import { auditLog, clients } from '../db/schema'
import { CLIENT_REGION, PREFERRED_CHANNEL } from '../db/schema/enums'

export const clientInput = z.object({
  companyName: z.string().trim().min(1, 'Give the client a name.').max(200),
  contactName: z.string().trim().max(200).optional(),
  email: z.string().trim().max(320).optional(),
  phoneE164: z.string().trim().max(32).optional(),
  region: z.enum(CLIENT_REGION),
  preferredChannel: z.enum(PREFERRED_CHANNEL),
  notes: z.string().trim().max(2000).optional(),
})

export type ClientInput = z.infer<typeof clientInput>

export async function createClient(input: ClientInput): Promise<string> {
  const actor = await requirePermission('client.manage')

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(clients)
      .values({
        orgId: actor.orgId,
        companyName: input.companyName,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phoneE164: input.phoneE164 ?? null,
        region: input.region,
        preferredChannel: input.preferredChannel,
        notes: input.notes ?? null,
      })
      .returning({ id: clients.id })

    const clientId = inserted[0]!.id

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'client.created',
      entityType: 'client',
      entityId: clientId,
      before: null,
      after: {
        title: input.companyName,
        region: input.region,
        preferredChannel: input.preferredChannel,
      },
    })

    return clientId
  })
}
