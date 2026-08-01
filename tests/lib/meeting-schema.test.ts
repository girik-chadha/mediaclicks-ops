import { describe, expect, it } from 'vitest'
import {
  generatesLink,
  meetingInput,
  outcomeSummary,
  providerCode,
} from '@/lib/meetings/schema'

const ME = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'

const base = {
  title: 'Retainer planning',
  startsAt: new Date('2026-08-03T09:30:00Z'),
  endsAt: new Date('2026-08-03T10:30:00Z'),
  attendeeIds: [ME],
}

describe('meeting validation (§4.1.1)', () => {
  it('accepts a team meeting with no client', () => {
    const r = meetingInput.safeParse({
      ...base,
      type: 'internal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(true)
  })

  it('accepts a client meeting with a client', () => {
    const r = meetingInput.safeParse({
      ...base,
      type: 'client',
      clientId: CLIENT,
      conferencingProvider: 'zoom',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a client meeting with no client', () => {
    // The union makes this shape unrepresentable rather than needing a
    // runtime `if` at every call site.
    const r = meetingInput.safeParse({
      ...base,
      type: 'client',
      conferencingProvider: 'zoom',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a client meeting on "no platform"', () => {
    // A client call has to happen somewhere; §4.1.1 offers three options.
    const r = meetingInput.safeParse({
      ...base,
      type: 'client',
      clientId: CLIENT,
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(false)
  })

  it('allows a team meeting to have no platform', () => {
    const r = meetingInput.safeParse({
      ...base,
      type: 'internal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown meeting type', () => {
    const r = meetingInput.safeParse({
      ...base,
      type: 'personal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(false)
  })

  it('rejects an end before the start', () => {
    const r = meetingInput.safeParse({
      ...base,
      endsAt: new Date('2026-08-03T09:00:00Z'),
      type: 'internal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('The meeting has to end after it starts.')
    }
  })

  it('rejects a zero-length meeting', () => {
    const r = meetingInput.safeParse({
      ...base,
      endsAt: base.startsAt,
      type: 'internal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(false)
  })

  it('rejects an empty attendee list', () => {
    const r = meetingInput.safeParse({
      ...base,
      attendeeIds: [],
      type: 'internal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a blank title', () => {
    const r = meetingInput.safeParse({
      ...base,
      title: '   ',
      type: 'internal',
      conferencingProvider: 'none',
    })
    expect(r.success).toBe(false)
  })

  it('narrows the type so clientId is only reachable on client meetings', () => {
    const r = meetingInput.safeParse({
      ...base,
      type: 'client',
      clientId: CLIENT,
      conferencingProvider: 'google_meet',
    })
    expect(r.success).toBe(true)
    if (r.success && r.data.type === 'client') {
      // Compiles only because the union narrowed — the point of the exercise.
      expect(r.data.clientId).toBe(CLIENT)
    }
  })
})

describe('link generation (§4.2)', () => {
  it('generates a link for Meet and Zoom only', () => {
    expect(generatesLink('google_meet')).toBe(true)
    expect(generatesLink('zoom')).toBe(true)
    expect(generatesLink('whatsapp')).toBe(false)
    expect(generatesLink('none')).toBe(false)
  })

  it('states the outcome before saving, per platform', () => {
    expect(outcomeSummary('zoom', 4)).toBe(
      'Zoom link will be created and emailed to 4 people.',
    )
    expect(outcomeSummary('google_meet', 1)).toBe(
      'Google Meet link will be created and emailed to 1 person.',
    )
    expect(outcomeSummary('whatsapp', 4)).toBe('No link. Reminders only.')
    expect(outcomeSummary('none', 4)).toBe('No link. Reminders only.')
  })

  it('uses monochrome codes, never brand names, in the grid', () => {
    expect(providerCode('google_meet')).toBe('MEET')
    expect(providerCode('zoom')).toBe('ZOOM')
    expect(providerCode('whatsapp')).toBe('WA')
  })
})
