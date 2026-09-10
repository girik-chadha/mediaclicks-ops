'use server'

import { changePassword } from '@/server/auth/change-password'
import { reportUnexpected } from '@/server/report'

export interface ChangePasswordState {
  error?: string
  done?: boolean
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  const current = String(form.get('current') ?? '')
  const next = String(form.get('next') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  if (!current || !next || !confirm) return { error: 'Fill in all three fields.' }

  try {
    const result = await changePassword(current, next, confirm)
    if (!result.ok) return { error: result.reason }
  } catch (error) {
    reportUnexpected('change password', error)
    return { error: 'That did not save. Try again.' }
  }

  return { done: true }
}
