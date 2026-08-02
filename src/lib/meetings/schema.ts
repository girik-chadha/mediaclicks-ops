import { z } from 'zod'
import { CONFERENCING_PROVIDER } from '@/server/db/schema/enums'

/**
 * Meeting validation (§4.1.1).
 *
 * A discriminated union on meeting type, so an invalid combination is
 * unrepresentable rather than caught by runtime `if`s: a team meeting has no
 * `clientId` and a client meeting requires one. The spec asks for exactly
 * this — "the type system should make an invalid combination unrepresentable"
 * — and the database backs it up with a CHECK constraint, because the app is
 * not the only thing that can write rows.
 */

/** Any of the four. Internal meetings may legitimately have no platform. */
const provider = z.enum(CONFERENCING_PROVIDER)

/** Client meetings always happen somewhere (§4.1.1 step 2b offers three). */
const clientProvider = z.enum(['google_meet', 'zoom', 'whatsapp'])

const base = z.object({
  title: z.string().trim().min(1, 'Give the meeting a title.').max(200),
  description: z.string().trim().max(5000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  /** Creator included by default and removable (§4.1.1 step 3). */
  attendeeIds: z.array(z.uuid()).min(1, 'A meeting needs at least one attendee.'),

  /**
   * The join link, pasted by whoever is scheduling.
   *
   * Nothing generates this. The organiser creates the call in Meet or Zoom
   * themselves and brings the link here, and the app's job is distribution:
   * it goes to the team in chat and to the client by email.
   */
  conferenceUrl: z
    .string()
    .trim()
    .url('That does not look like a link. Paste the full URL.')
    .max(2048)
    .optional(),
})

const teamMeeting = base.extend({
  type: z.literal('internal'),
  conferencingProvider: provider,
})

const clientMeeting = base.extend({
  type: z.literal('client'),
  clientId: z.uuid('Choose a client.'),
  conferencingProvider: clientProvider,
})

export const meetingInput = z
  .discriminatedUnion('type', [teamMeeting, clientMeeting])
  .refine((m) => m.endsAt.getTime() > m.startsAt.getTime(), {
    message: 'The meeting has to end after it starts.',
    path: ['endsAt'],
  })
  .refine((m) => m.endsAt.getTime() - m.startsAt.getTime() <= 12 * 60 * 60 * 1000, {
    message: 'A meeting longer than 12 hours is probably a mistake.',
    path: ['endsAt'],
  })
  // Meet and Zoom are link-based, so choosing one and pasting nothing leaves
  // everybody with a calendar entry and no way to join. WhatsApp and "no
  // platform" have nothing to paste, by design (§4.3.1).
  .refine((m) => !generatesLink(m.conferencingProvider) || Boolean(m.conferenceUrl), {
    message: 'Paste the meeting link, or pick a platform that does not need one.',
    path: ['conferenceUrl'],
  })
  .refine((m) => generatesLink(m.conferencingProvider) || !m.conferenceUrl, {
    message: 'That platform has no link. Clear it, or pick Google Meet or Zoom.',
    path: ['conferenceUrl'],
  })

export type MeetingInput = z.infer<typeof meetingInput>

/** Editing takes the same shape plus the id — §4.1.1: one modal, prefilled. */
export const meetingUpdateInput = z.object({ id: z.uuid() }).and(meetingInput)
export type MeetingUpdateInput = z.infer<typeof meetingUpdateInput>

export const cancelMeetingInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().max(500).optional(),
})

/**
 * Whether this choice produces a join link (§4.2).
 *
 * The single place that knows. Callers never branch on the provider name —
 * that is what keeps the creation flow clean when a fourth provider lands.
 */
export function generatesLink(provider: (typeof CONFERENCING_PROVIDER)[number]): boolean {
  return provider === 'google_meet' || provider === 'zoom'
}

const PROVIDER_LABEL: Record<(typeof CONFERENCING_PROVIDER)[number], string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  whatsapp: 'WhatsApp',
  none: 'No platform',
}

export function providerLabel(provider: (typeof CONFERENCING_PROVIDER)[number]): string {
  return PROVIDER_LABEL[provider]
}

/** Short monospace code for the grid, per the design (MEET / ZOOM / WA). */
const PROVIDER_CODE: Record<(typeof CONFERENCING_PROVIDER)[number], string> = {
  google_meet: 'MEET',
  zoom: 'ZOOM',
  whatsapp: 'WA',
  none: '—',
}

export function providerCode(provider: (typeof CONFERENCING_PROVIDER)[number]): string {
  return PROVIDER_CODE[provider]
}

/**
 * §4.1.1 step 4: say exactly what will happen before saving.
 *
 * The likeliest error is no longer "expected a link and did not get one" —
 * nothing generates links now — but "did not realise this would be sent to
 * the client". So the sentence names the recipients, not the mechanism.
 */
export function outcomeSummary(
  provider: (typeof CONFERENCING_PROVIDER)[number],
  teamCount: number,
  clientName?: string | null,
): string {
  const team = `${teamCount} ${teamCount === 1 ? 'person' : 'people'}`

  if (!generatesLink(provider)) {
    return clientName
      ? `No link. ${team} get it in chat; ${clientName} is not emailed.`
      : `No link. ${team} get it in chat.`
  }

  return clientName
    ? `Link goes to ${team} in chat and by email to ${clientName}.`
    : `Link goes to ${team} in chat.`
}
