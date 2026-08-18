'use server'

import { revalidatePath } from 'next/cache'
import { reportUnexpected } from '@/server/report'
import { generatesLink, meetingInput } from '@/lib/meetings/schema'
import { fromWallClock } from '@/lib/time'
import { requireActor } from '@/server/auth/session'
import { cancelMeeting, createMeeting, updateMeeting } from '@/server/meetings/mutations'
import { findConflicts } from '@/server/meetings/queries'

export interface MeetingFormState {
  error?: string
  created?: string
  updated?: string
  /** Warnings, never blockers (§4.1). */
  conflicts?: { fullName: string; meetingTitle: string }[]
}

function fieldOf(form: FormData, name: string): string | undefined {
  const value = form.get(name)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}

/** Parses the form into validated input, or returns the first message. */
async function parseForm(form: FormData) {
  const actor = await requireActor()

  const type = fieldOf(form, 'type')
  const date = fieldOf(form, 'date')
  const start = fieldOf(form, 'start')
  const end = fieldOf(form, 'end')

  if (!type || !date || !start || !end) {
    return { error: 'Pick a meeting type, a date and a time.' as const }
  }

  // The browser sends wall-clock date and time; the zone is the actor's, so
  // the same form produces the same instant regardless of where it is filled.
  const toInstant = (hhmm: string) => {
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = hhmm.split(':').map(Number)
    return fromWallClock(
      { year: y!, month: m!, day: d!, hour: hh!, minute: mm! },
      actor.timezone,
    )
  }

  const attendeeIds = form.getAll('attendeeIds').map(String).filter(Boolean)

  // Cast, not re-derived: generatesLink is the single place that knows which
  // platforms carry a link (schema.ts), and an invalid name here is caught a
  // few lines below by the enum the same schema declares.
  const provider = (fieldOf(form, 'conferencingProvider') ??
    'none') as Parameters<typeof generatesLink>[0]

  const parsed = meetingInput.safeParse({
    type,
    title: fieldOf(form, 'title'),
    description: fieldOf(form, 'description'),
    startsAt: toInstant(start),
    endsAt: toInstant(end),
    attendeeIds: attendeeIds.length > 0 ? attendeeIds : [actor.id],
    conferencingProvider: provider,
    // Pasted by the organiser, and genuinely dropped when the platform has
    // no link — which is what the comment here always claimed and the code
    // did not do. Editing a Zoom call down to WhatsApp kept the dead Zoom
    // URL in the payload, and the schema rejects that combination, so the
    // save failed on a field the person had already cleared from the form.
    conferenceUrl: generatesLink(provider) ? fieldOf(form, 'conferenceUrl') : undefined,
    ...(type === 'client' ? { clientId: fieldOf(form, 'clientId') } : {}),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  return { actor, data: parsed.data }
}

export async function createMeetingAction(
  _prev: MeetingFormState,
  form: FormData,
): Promise<MeetingFormState> {
  const result = await parseForm(form)
  if ('error' in result) return { error: result.error }

  const conflicts = await findConflicts(result.actor, {
    startsAt: result.data.startsAt,
    endsAt: result.data.endsAt,
    attendeeIds: result.data.attendeeIds,
  })

  try {
    await createMeeting(result.data)
  } catch (error) {
    return { error: messageFor(error) }
  }

  revalidatePath('/calendar')
  revalidatePath('/today')
  revalidatePath('/home')

  return {
    created: result.data.title,
    conflicts: conflicts.map((c) => ({ fullName: c.fullName, meetingTitle: c.meetingTitle })),
  }
}

export async function updateMeetingAction(
  _prev: MeetingFormState,
  form: FormData,
): Promise<MeetingFormState> {
  const id = fieldOf(form, 'id')
  if (!id) return { error: 'That meeting no longer exists.' }

  const result = await parseForm(form)
  if ('error' in result) return { error: result.error }

  // The meeting being edited is excluded, or it would conflict with itself.
  const conflicts = await findConflicts(result.actor, {
    startsAt: result.data.startsAt,
    endsAt: result.data.endsAt,
    attendeeIds: result.data.attendeeIds,
    excludeMeetingId: id,
  })

  try {
    await updateMeeting({ id, ...result.data })
  } catch (error) {
    return { error: messageFor(error) }
  }

  revalidatePath('/calendar')
  revalidatePath('/today')
  revalidatePath('/home')

  return {
    updated: result.data.title,
    conflicts: conflicts.map((c) => ({ fullName: c.fullName, meetingTitle: c.meetingTitle })),
  }
}

export async function cancelMeetingAction(id: string): Promise<{ error?: string }> {
  try {
    await cancelMeeting(id)
  } catch (error) {
    return { error: messageFor(error) }
  }

  revalidatePath('/calendar')
  revalidatePath('/today')
  revalidatePath('/home')
  return {}
}

/**
 * ForbiddenError and MeetingNotFoundError already carry a sentence written in
 * §8's voice. Anything else gets a generic line — an unexpected error's
 * message is for the logs, not the reader.
 *
 * "For the logs" was aspirational: nothing logged it. An unexpected failure
 * showed the reader six words and told the developer nothing at all, which
 * is the worst of both — the person cannot act on it and neither can anyone
 * fixing it. Server actions run on the server, so console.error lands in the
 * terminal running `next dev` and in the platform's logs once deployed.
 */
function messageFor(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'ForbiddenError' || error.name === 'MeetingNotFoundError') {
      return error.message
    }
  }

  reportUnexpected('meeting action', error)
  return 'That did not save. Try again.'
}
