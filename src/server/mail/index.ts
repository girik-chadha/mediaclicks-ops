import 'server-only'
import { withRetry } from '@/lib/retry'

/**
 * Outbound email.
 *
 * One interface, one implementation, and an honest "not configured" state —
 * the same shape the conferencing layer had, kept for the same reason: the
 * caller must not have to know whether credentials exist. Without a key,
 * sending reports itself unconfigured and the meeting is unaffected.
 */

export interface Email {
  to: string
  subject: string
  text: string
}

export class MailUnavailableError extends Error {
  override readonly name: string = 'MailUnavailableError'
  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Email could not be sent: ${reason}`, options)
  }
}

export class MailNotConfiguredError extends MailUnavailableError {
  override readonly name = 'MailNotConfiguredError'
  constructor(missing: string) {
    super(`${missing} is not set`)
  }
}

export function mailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

/**
 * Sends one email through Resend.
 *
 * Retried with backoff (§7), but a 4xx is not — a rejected address or a bad
 * key will not fix itself, and retrying it only delays the error.
 */
export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (!apiKey) throw new MailNotConfiguredError('RESEND_API_KEY')
  if (!from) throw new MailNotConfiguredError('MAIL_FROM')

  await withRetry(
    async () => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new MailUnavailableError(`${response.status} ${detail.slice(0, 200)}`)
      }
    },
    {
      retryable: (error) => {
        if (error instanceof MailNotConfiguredError) return false
        if (error instanceof MailUnavailableError) return !/\b4\d\d\b/.test(error.reason)
        return true
      },
    },
  )
}
