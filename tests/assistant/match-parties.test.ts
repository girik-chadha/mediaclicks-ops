import { describe, expect, it } from 'vitest'
import { matchParties } from '@/lib/assistant/match-parties'

/**
 * The bug this file exists for: someone answered "who is it with?" by
 * typing "with emma girik miniz lina and the client is al barsha motors",
 * and the assistant looked for a single person called "emma girik miniz
 * lina". Splitting on "and" makes four names one; splitting on spaces makes
 * "Al Barsha Motors" three clients. Neither rule survives real input, so
 * nothing is split — known names are matched instead.
 */

const CLIENTS = [
  { id: 'c1', companyName: 'Al Barsha Motors' },
  { id: 'c2', companyName: 'Nuvel Cosmetics' },
  { id: 'c3', companyName: 'Fern & Field' },
]

const TEAM = [
  { id: 'p1', fullName: 'Emma Fischer' },
  { id: 'p2', fullName: 'Lina Tarek' },
  { id: 'p3', fullName: 'Miniz' },
  { id: 'p4', fullName: 'Omar Khalil' },
]

const match = (phrase: string, team = TEAM) => matchParties(phrase, CLIENTS, team)
const names = (phrase: string, team = TEAM) =>
  match(phrase, team).people.map((p) => p.fullName).sort()
const firms = (phrase: string) => match(phrase).clients.map((c) => c.companyName).sort()

describe('matching people and clients in a phrase', () => {
  it('reads the sentence that started this', () => {
    const r = match('emma miniz lina and the client is al barsha motors')
    expect(r.people.map((p) => p.fullName).sort()).toEqual([
      'Emma Fischer',
      'Lina Tarek',
      'Miniz',
    ])
    expect(r.clients.map((c) => c.companyName)).toEqual(['Al Barsha Motors'])
  })

  it('does not need a separator at all', () => {
    expect(names('emma lina omar')).toEqual(['Emma Fischer', 'Lina Tarek', 'Omar Khalil'])
  })

  it('takes commas, "and", or both', () => {
    expect(names('emma, lina and omar')).toEqual(['Emma Fischer', 'Lina Tarek', 'Omar Khalil'])
    expect(names('emma and lina')).toEqual(['Emma Fischer', 'Lina Tarek'])
  })

  it('keeps a multi-word client whole', () => {
    // The failure this guards: splitting on spaces turns one client into
    // three unmatched words.
    expect(firms('al barsha motors')).toEqual(['Al Barsha Motors'])
    expect(firms('fern & field')).toEqual(['Fern & Field'])
  })

  it('takes first names or full names', () => {
    expect(names('sara')).toEqual([])
    expect(names('emma fischer')).toEqual(['Emma Fischer'])
    expect(names('emma')).toEqual(['Emma Fischer'])
  })

  it('ignores the words between the names', () => {
    expect(match('emma and the client is nuvel cosmetics').clients).toHaveLength(1)
    expect(names('put emma and omar on it')).toEqual(['Emma Fischer', 'Omar Khalil'])
  })

  it('never counts the same person twice', () => {
    expect(names('emma fischer and emma')).toEqual(['Emma Fischer'])
  })

  it('asks rather than guessing when a name is shared', () => {
    // Two people called Emma means "emma" cannot be resolved by a computer,
    // and guessing puts the wrong person in a meeting.
    const withDup = [...TEAM, { id: 'p9', fullName: 'Emma Watson' }]
    const r = match('emma and lina', withDup)
    expect(r.ambiguous?.term).toBe('emma')
    expect(r.ambiguous?.options.sort()).toEqual(['Emma Fischer', 'Emma Watson'])
    // Nothing is returned alongside an ambiguity — a half-answer that looked
    // usable would be worse than the question.
    expect(r.people).toEqual([])
    expect(r.clients).toEqual([])
  })

  it('finds nothing in a phrase with no names', () => {
    const r = match('nobody i know')
    expect(r.people).toEqual([])
    expect(r.clients).toEqual([])
    expect(r.ambiguous).toBeNull()
  })

  it('reports every client named, so the caller can refuse two', () => {
    expect(firms('al barsha motors and nuvel cosmetics')).toEqual([
      'Al Barsha Motors',
      'Nuvel Cosmetics',
    ])
  })
})
