import 'server-only'
import { withRetry } from '@/lib/retry'
import type { ConferencingProvider } from '../db/schema/enums'
import {
  ConferenceNotConfiguredError,
  ConferenceUnavailableError,
  type ConferenceContext,
  type ConferenceDetails,
  type ConferenceProvider,
} from './types'

const NO_LINK: ConferenceDetails = { url: null, externalId: null }

/**
 * No platform. A schedule entry and reminders, nothing else.
 *
 * A real implementation rather than a null check at the call site — that is
 * the whole point of §4.2's single interface.
 */
const noPlatform: ConferenceProvider = {
  key: 'none',
  generatesLink: false,
  async create() {
    return NO_LINK
  },
  async update() {
    return NO_LINK
  },
  async cancel() {
    // Nothing was created, so there is nothing to revoke.
  },
}

/**
 * WhatsApp. Deliberately identical behaviour to `none`, deliberately a
 * separate implementation.
 *
 * §4.3.1: the call is *held* on WhatsApp, which needs no API, no Cloud API,
 * no Meta business verification. Collapsing it into `none` would lose the
 * distinction the UI depends on — a WhatsApp meeting shows the client's phone
 * number, a no-platform meeting shows nothing — and would quietly invite
 * someone later to "add the WhatsApp integration" that this design says must
 * not exist.
 */
const whatsapp: ConferenceProvider = {
  key: 'whatsapp',
  generatesLink: false,
  async create() {
    return NO_LINK
  },
  async update() {
    return NO_LINK
  },
  async cancel() {
    // No link was issued; the call happens in WhatsApp as normal.
  },
}

/** Credentials are read per call, so a deploy that adds them needs no restart. */
function requireEnv(provider: ConferencingProvider, name: string): string {
  const value = process.env[name]
  if (!value) throw new ConferenceNotConfiguredError(provider, name)
  return value
}

/** A 4xx will not fix itself; a 5xx or a network blip might. */
function retryableHttp(error: unknown): boolean {
  if (error instanceof ConferenceNotConfiguredError) return false
  if (error instanceof ConferenceUnavailableError) {
    return !/\b4\d\d\b/.test(error.reason)
  }
  return true
}

/**
 * Google Meet, via Calendar API events.insert with conferenceData.createRequest.
 *
 * Not wired up: it needs per-user Google OAuth with the calendar scope and
 * encrypted refresh tokens (§4.2), and §8 still has "Workspace or personal
 * Gmail?" open, which decides the verification path. Until those land it
 * reports itself unconfigured, which the caller already handles by saving the
 * meeting without a link and offering a retry — the same path a real outage
 * takes, so this is not a special case either.
 */
const googleMeet: ConferenceProvider = {
  key: 'google_meet',
  generatesLink: true,
  async create(context) {
    return withRetry(() => createGoogleMeet(context), { retryable: retryableHttp })
  },
  async update(externalId, context) {
    return withRetry(() => createGoogleMeet(context, externalId), { retryable: retryableHttp })
  },
  async cancel(externalId) {
    requireEnv('google_meet', 'GOOGLE_CLIENT_ID')
    void externalId
  },
}

async function createGoogleMeet(
  context: ConferenceContext,
  externalId?: string,
): Promise<ConferenceDetails> {
  requireEnv('google_meet', 'GOOGLE_CLIENT_ID')
  requireEnv('google_meet', 'GOOGLE_CLIENT_SECRET')
  void context
  void externalId
  throw new ConferenceNotConfiguredError('google_meet', 'Google Calendar OAuth')
}

/**
 * Zoom, via a Server-to-Server OAuth app and POST /users/me/meetings.
 *
 * One org-level integration rather than per-user, unlike Meet. Requires a
 * paid plan, which §8 lists as unanswered.
 */
const zoom: ConferenceProvider = {
  key: 'zoom',
  generatesLink: true,
  async create(context) {
    return withRetry(() => createZoom(context), { retryable: retryableHttp })
  },
  async update(externalId, context) {
    return withRetry(() => createZoom(context, externalId), { retryable: retryableHttp })
  },
  async cancel(externalId) {
    requireEnv('zoom', 'ZOOM_ACCOUNT_ID')
    void externalId
  },
}

async function createZoom(
  context: ConferenceContext,
  externalId?: string,
): Promise<ConferenceDetails> {
  requireEnv('zoom', 'ZOOM_ACCOUNT_ID')
  requireEnv('zoom', 'ZOOM_CLIENT_ID')
  requireEnv('zoom', 'ZOOM_CLIENT_SECRET')
  void context
  void externalId
  throw new ConferenceNotConfiguredError('zoom', 'Zoom Server-to-Server OAuth')
}

const REGISTRY: Record<ConferencingProvider, ConferenceProvider> = {
  none: noPlatform,
  whatsapp,
  google_meet: googleMeet,
  zoom,
}

/**
 * The provider for a choice. Total over the enum, so adding a value to
 * CONFERENCING_PROVIDER without adding an implementation is a type error
 * rather than a runtime surprise.
 */
export function providerFor(key: ConferencingProvider): ConferenceProvider {
  return REGISTRY[key]
}

export { noPlatform, whatsapp, googleMeet, zoom }
