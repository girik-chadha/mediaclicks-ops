import type { ConferencingProvider } from '../db/schema/enums'

/**
 * The one interface all three platforms sit behind (§4.2).
 *
 * The point is that calling code never branches on which platform was
 * chosen. WhatsApp and "no platform" are real implementations that return a
 * null URL rather than special cases the caller has to remember — which is
 * what keeps the meeting-creation flow readable, and what makes adding a
 * fourth platform a new file instead of an edit to every call site.
 */

export interface ConferenceDetails {
  /** Null is a legitimate result, not a failure. WhatsApp has no link. */
  url: string | null
  /** The platform's own id, kept so the link can later be updated or revoked. */
  externalId: string | null
}

export interface ConferenceContext {
  title: string
  description?: string | null
  startsAt: Date
  endsAt: Date
  organiserEmail: string
  attendeeEmails: readonly string[]
  timezone: string
}

export interface ConferenceProvider {
  readonly key: ConferencingProvider
  /** Whether this platform produces a joinable link at all. */
  readonly generatesLink: boolean
  create(context: ConferenceContext): Promise<ConferenceDetails>
  update(externalId: string, context: ConferenceContext): Promise<ConferenceDetails>
  cancel(externalId: string): Promise<void>
}

/**
 * The platform could not produce a link right now.
 *
 * §4.2 is explicit that this must not lose the meeting: it saves with a null
 * URL and the UI offers a retry. Typed rather than a thrown string (§7) so
 * the caller can tell a recoverable provider outage apart from a bug.
 */
export class ConferenceUnavailableError extends Error {
  // Widened so the subclass can narrow it. Literal-typing it here would make
  // ConferenceNotConfiguredError unassignable to its own base.
  override readonly name: string = 'ConferenceUnavailableError'
  constructor(
    readonly provider: ConferencingProvider,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`${provider} could not create a link: ${reason}`, options)
  }
}

/** The integration has not been configured — missing credentials, not an outage. */
export class ConferenceNotConfiguredError extends ConferenceUnavailableError {
  override readonly name = 'ConferenceNotConfiguredError'
  constructor(provider: ConferencingProvider, missing: string) {
    super(provider, `${missing} is not set`)
  }
}
