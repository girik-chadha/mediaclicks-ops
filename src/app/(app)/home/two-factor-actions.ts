'use server'

import { revalidatePath } from 'next/cache'
import {
  TwoFactorUnavailableError,
  dismissTwoFactorPrompt,
  enableTwoFactor,
} from '@/server/auth/two-factor-settings'
import { reportUnexpected } from '@/server/report'

/** The two buttons on the Home offer. Profile has its own pair. */

export type EnableResult = { ok: true } | { ok: false; error: string }

export async function enableTwoFactorAction(): Promise<EnableResult> {
  try {
    await enableTwoFactor()
    revalidatePath('/home')
    revalidatePath('/profile')
    return { ok: true }
  } catch (error) {
    // The one failure worth naming: it tells the person what to ask for.
    if (error instanceof TwoFactorUnavailableError) {
      return { ok: false, error: error.message }
    }
    reportUnexpected('enable two-factor', error)
    return { ok: false, error: 'That did not save. Try again.' }
  }
}

export async function dismissOfferAction(): Promise<void> {
  try {
    await dismissTwoFactorPrompt()
    revalidatePath('/home')
  } catch (error) {
    // Nothing is shown for this. The card is already gone from the screen,
    // and the worst case is that it comes back next time — which is a far
    // smaller annoyance than an error toast about declining a suggestion.
    reportUnexpected('dismiss two-factor offer', error)
  }
}
