'use server'

import { revalidatePath } from 'next/cache'
import {
  TwoFactorUnavailableError,
  disableTwoFactor,
  enableTwoFactor,
} from '@/server/auth/two-factor-settings'
import { reportUnexpected } from '@/server/report'

export type ToggleResult = { ok: true } | { ok: false; error: string }

/** One action for both directions, so the two can never drift apart. */
export async function setTwoFactorAction(on: boolean): Promise<ToggleResult> {
  try {
    if (on) await enableTwoFactor()
    else await disableTwoFactor()

    revalidatePath('/profile')
    revalidatePath('/home')
    return { ok: true }
  } catch (error) {
    if (error instanceof TwoFactorUnavailableError) {
      return { ok: false, error: error.message }
    }
    reportUnexpected('set two-factor', error)
    return { ok: false, error: 'That did not save. Try again.' }
  }
}
