'use server'

import { revalidatePath } from 'next/cache'
import { clientInput } from '@/server/clients/mutations'

export interface ClientFormState {
  error?: string
  created?: string
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
    return { error: 'That client could not be saved. Try again.' }
  }

  revalidatePath('/clients')
  revalidatePath('/calendar')
  return { created: parsed.data.companyName }
}
