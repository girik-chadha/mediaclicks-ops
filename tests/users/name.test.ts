import { describe, expect, it } from 'vitest'
import { displayFirstName, joinName, splitFullName } from '@/lib/users/name'

/**
 * The greeting's fallback chain, and the split the backfill relies on.
 *
 * The chain is pinned because its failure is a word on the screen: "Hello,
 * undefined." is the kind of bug a product ships for a month before anyone
 * mentions it, and it costs one test to make impossible.
 */

describe('what the greeting calls you', () => {
  it('uses the first name when there is one', () => {
    expect(displayFirstName('Girik', 'girikchadha@gmail.com')).toBe('Girik')
  })

  it('trims it, so a stray space cannot render as a blank', () => {
    expect(displayFirstName('  Miniz  ', 'x@y.com')).toBe('Miniz')
  })

  it('falls back to the part of the address before the @', () => {
    expect(displayFirstName('', 'cjdowork@gmail.com')).toBe('cjdowork')
    expect(displayFirstName(null, 'lokhind7@gmail.com')).toBe('lokhind7')
    expect(displayFirstName(undefined, 'parth@x.com')).toBe('parth')
  })

  it('never prints undefined, null or nothing', () => {
    for (const first of ['', '   ', null, undefined]) {
      const out = displayFirstName(first, '')
      expect(out).toBe('there')
      expect(out).not.toMatch(/undefined|null/)
      expect(out.trim()).not.toBe('')
    }
  })
})

describe('splitting a whole name', () => {
  it('splits on the first space only', () => {
    expect(splitFullName('Rohaan Fernandes')).toEqual({
      firstName: 'Rohaan',
      lastName: 'Fernandes',
    })
    // Deliberately naive: there is no correct general rule, and the person
    // corrects it in Profile with two fields in front of them.
    expect(splitFullName('Mary Anne Smith')).toEqual({
      firstName: 'Mary',
      lastName: 'Anne Smith',
    })
  })

  it('makes a single token a first name with no last name', () => {
    // Most of this team goes by one name. An empty-string last name would
    // be a sentinel every reader has to remember to strip.
    expect(splitFullName('Miniz')).toEqual({ firstName: 'Miniz', lastName: null })
  })

  it('collapses runs of whitespace and trims', () => {
    expect(splitFullName('  Jason   Dennis ')).toEqual({
      firstName: 'Jason',
      lastName: 'Dennis',
    })
  })

  it('round-trips through joinName to exactly what the database generates', () => {
    for (const full of ['Girik Chadha', 'Miniz', 'Mary Anne Smith']) {
      expect(joinName(splitFullName(full))).toBe(full)
    }
    expect(joinName({ firstName: 'CJ', lastName: null })).toBe('CJ')
  })
})
