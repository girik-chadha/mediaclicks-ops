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
 * §4.1.1 step 4: say exactly what will happen before saving. This kills the
 * likeliest user error, which is expecting a link and not getting one.
 */
export function outcomeSummary(
  provider: (typeof CONFERENCING_PROVIDER)[number],
  recipientCount: number,
): string {
  if (!generatesLink(provider)) return 'No link. Reminders only.'
  const people = `${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}`
  return `${providerLabel(provider)} link will be created and emailed to ${people}.`
}
