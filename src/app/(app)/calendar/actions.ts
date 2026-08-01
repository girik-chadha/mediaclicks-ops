'use server'

import { revalidatePath } from 'next/cache'
import { meetingInput } from '@/lib/meetings/schema'
import { requireActor } from '@/server/auth/session'
import { cancelMeeting, createMeeting } from '@/server/meetings/mutations'
import { findConflicts } from '@/server/meetings/queries'

export interface MeetingFormState {
  error?: string
  created?: string
  /** Warnings, never blockers (§4.1). */
  conflicts?: { fullName: string; meetingTitle: string }[]
}

function fieldOf(form: FormData, name: string): string | undefined {
  const value = form.get(name)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}

export async function createMeetingAction(
  _prev: MeetingFormState,
  form: FormData,
): Promise<MeetingFormState> {
  const actor = await requireActor()

  const type = fieldOf(form, 'type')
  const date = fieldOf(form, 'date')
  const start = fieldOf(form, 'start')
  const end = fieldOf(form, 'end')

  if (!type || !date || !start || !end) {
    return { error: 'Pick a meeting type, a date and a time.' }
  }

  // The browser sends wall-clock date and time; the zone is the actor's.
  const { fromWallClock } = await import('@/lib/time')
  const toInstant = (hhmm: string) => {
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = hhmm.split(':').map(Number)
    return fromWallClock(
      { year: y!, month: m!, day: d!, hour: hh!, minute: mm! },
      actor.timezone,
    )
  }

  const attendeeIds = form.getAll('attendeeIds').map(String).filter(Boolean)

  const parsed = meetingInput.safeParse({
    type,
    title: fieldOf(form, 'title'),
    description: fieldOf(form, 'description'),
    startsAt: toInstant(start),
    endsAt: toInstant(end),
    attendeeIds: attendeeIds.length > 0 ? attendeeIds : [actor.id],
    conferencingProvider: fieldOf(form, 'conferencingProvider') ?? 'none',
    ...(type === 'client' ? { clientId: fieldOf(form, 'clientId') } : {}),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  // Warn, do not block (§4.1). Surfaced after saving so a genuine
  // double-booking is still possible when the person means it.
  const conflicts = await findConflicts(actor, {
    startsAt: parsed.data.startsAt,
    endsAt: parsed.data.endsAt,
    attendeeIds: parsed.data.attendeeIds,
  })

  try {
    await createMeeting(parsed.data)
  } catch (error) {
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return { error: error.message }
    }
    throw error
  }

  revalidatePath('/calendar')
  revalidatePath('/today')

  return {
    created: parsed.data.title,
    conflicts: conflicts.map((c) => ({ fullName: c.fullName, meetingTitle: c.meetingTitle })),
  }
}

export async function cancelMeetingAction(id: string): Promise<void> {
  await cancelMeeting(id)
  revalidatePath('/calendar')
  revalidatePath('/today')
}
