import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../auth/require'
import { db } from '../db'
import { auditLog, clients } from '../db/schema'
import { CLIENT_REGION, PREFERRED_CHANNEL } from '../db/schema/enums'

export const clientInput = z.object({
  companyName: z.string().trim().min(1, 'Give the client a name.').max(200),
  contactName: z.string().trim().max(200).optional(),
  /**
   * Checked for shape, not just length.
   *
   * §4.2 emails the client when a meeting is booked, and a malformed address
   * fails at send time — where the failure is a line in the audit log rather
   * than a message to the person who typed it. Catching it here puts the
   * complaint next to the field.
   */
  email: z
    .string()
    .trim()
    .max(320)
    .email('That does not look like an email address.')
    .optional(),
  phoneE164: z.string().trim().max(32).optional(),
  region: z.enum(CLIENT_REGION),
  preferredChannel: z.enum(PREFERRED_CHANNEL),
  notes: z.string().trim().max(2000).optional(),
})

export type ClientInput = z.infer<typeof clientInput>

/** The same fields plus which row they belong to. */
export const clientUpdateInput = z.object({ id: z.uuid() }).and(clientInput)
export type ClientUpdateInput = z.infer<typeof clientUpdateInput>

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

/** What an audit row records about a client, before and after. */
function auditShape(c: {
  companyName: string
  contactName: string | null
  email: string | null
  phoneE164: string | null
  region: string
  preferredChannel: string
  notes: string | null
}): Record<string, unknown> {
  return {
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    phoneE164: c.phoneE164,
    region: c.region,
    preferredChannel: c.preferredChannel,
    notes: c.notes,
  }
}

/**
 * Edits a client (companyName, contact, email, phone, region, channel, notes).
 *
 * Guarded by `client.manage` — the same key that gates creating one, checked
 * through the same `requirePermission` the button's visibility is derived
 * from, so hiding the control and refusing the action cannot disagree.
 *
 * The pre-image is read inside the transaction and scoped to the actor's
 * org, which does double duty: it gives the audit row something to diff
 * against, and it means a client id from another organisation is simply not
 * found rather than being updated by an org-blind WHERE.
 */
export async function updateClient(input: ClientUpdateInput): Promise<void> {
  const actor = await requirePermission('client.manage')

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.orgId, actor.orgId), eq(clients.id, input.id)))
      .limit(1)

    if (!existing) throw new ClientNotFoundError()

    await tx
      .update(clients)
      .set({
        companyName: input.companyName,
        // Explicit nulls, not `?? existing.x`: clearing a field is an edit
        // like any other, and a form that cannot empty a box is a form that
        // makes you keep a wrong phone number forever.
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phoneE164: input.phoneE164 ?? null,
        region: input.region,
        preferredChannel: input.preferredChannel,
        notes: input.notes ?? null,
      })
      .where(and(eq(clients.orgId, actor.orgId), eq(clients.id, input.id)))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'client.updated',
      entityType: 'client',
      entityId: input.id,
      before: auditShape(existing),
      after: auditShape({
        companyName: input.companyName,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phoneE164: input.phoneE164 ?? null,
        region: input.region,
        preferredChannel: input.preferredChannel,
        notes: input.notes ?? null,
      }),
    })
  })
}

export class ClientNotFoundError extends Error {
  override readonly name = 'ClientNotFoundError'
  constructor() {
    super('That client no longer exists.')
  }
}
