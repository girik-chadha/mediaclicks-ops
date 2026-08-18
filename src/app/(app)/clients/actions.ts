'use server'

import { revalidatePath } from 'next/cache'
import { reportUnexpected } from '@/server/report'
import { clientInput, clientUpdateInput } from '@/server/clients/mutations'

export interface ClientFormState {
  error?: string
  created?: string
  updated?: string
}

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}

export async function createClientAction(
  _prev: ClientFormState,
  form: FormData,
): Promise<ClientFormState> {
  const parsed = clientInput.safeParse({
    companyName: field(form, 'companyName'),
    contactName: field(form, 'contactName'),
    email: field(form, 'email'),
    phoneE164: field(form, 'phoneE164'),
    region: field(form, 'region') ?? 'domestic',
    preferredChannel: field(form, 'preferredChannel') ?? 'email',
    notes: field(form, 'notes'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  try {
    const { createClient } = await import('@/server/clients/mutations')
    await createClient(parsed.data)
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return { error: error.message }
    }
    reportUnexpected('client create', error)
    return { error: 'That client could not be saved. Try again.' }
  }

  revalidatePath('/clients')
  revalidatePath('/calendar')
  return { created: parsed.data.companyName }
}

/**
 * Edits an existing client.
 *
 * Deliberately not folded into createClientAction with an optional id. The
 * two differ in what a missing id *means*: absent it is a new client, and
 * one action that branches on that would create a duplicate the moment the
 * hidden field failed to render — silently, and named the same thing.
 */
export async function updateClientAction(
  _prev: ClientFormState,
  form: FormData,
): Promise<ClientFormState> {
  const id = field(form, 'id')
  if (!id) return { error: 'That client no longer exists.' }

  const parsed = clientUpdateInput.safeParse({
    id,
    companyName: field(form, 'companyName'),
    contactName: field(form, 'contactName'),
    email: field(form, 'email'),
    phoneE164: field(form, 'phoneE164'),
    region: field(form, 'region') ?? 'domestic',
    preferredChannel: field(form, 'preferredChannel') ?? 'email',
    notes: field(form, 'notes'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  try {
    const { updateClient } = await import('@/server/clients/mutations')
    await updateClient(parsed.data)
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'ForbiddenError' || error.name === 'ClientNotFoundError')
    ) {
      // Both messages are already written for a person to read.
      return { error: error.message }
    }
    reportUnexpected('client update', error)
    return { error: 'Those changes could not be saved. Try again.' }
  }

  // The name and the email show up on the calendar's client picker and on
  // every meeting card, so those screens are stale the moment this succeeds.
  revalidatePath('/clients')
  revalidatePath('/calendar')
  revalidatePath('/today')
  revalidatePath('/home')
  return { updated: parsed.data.companyName }
}
