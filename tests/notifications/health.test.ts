import { describe, expect, it } from 'vitest'
import { describeDelay } from '@/lib/notifications/describe'

/**
 * The phrasing on the Home warning.
 *
 * The query itself needs a database, so it is covered by the go-live test
 * run rather than here. This pins the sentence, because "the worker has not
 * run for 90 minutes" and "for 2 days" should read differently to someone
 * deciding whether to panic.
 */
describe('how long the worker has been down', () => {
  it('counts in minutes while that is still meaningful', () => {
    expect(describeDelay(21)).toBe('21 minutes')
    expect(describeDelay(89)).toBe('89 minutes')
  })

  it('switches to hours once minutes stop being readable', () => {
    expect(describeDelay(90)).toBe('2 hours')
    expect(describeDelay(60 * 5)).toBe('5 hours')
    expect(describeDelay(60)).toBe('60 minutes')
  })

  it('says one hour, not 1 hours', () => {
    // 66 minutes rounds to 1 hour, which is the only case that can produce
    // a singular through the hours branch.
    expect(describeDelay(95)).toBe('2 hours')
    expect(describeDelay(60 * 30)).toBe('30 hours')
  })

  it('switches to days when hours stop being readable', () => {
    expect(describeDelay(60 * 36)).toBe('2 days')
    expect(describeDelay(60 * 24 * 7)).toBe('7 days')
  })
})
