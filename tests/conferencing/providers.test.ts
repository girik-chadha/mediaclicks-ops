import { describe, expect, it, vi } from 'vitest'
import { withRetry } from '@/lib/retry'
import { CONFERENCING_PROVIDER } from '@/server/db/schema/enums'
import { providerFor } from '@/server/conferencing/providers'
import {
  ConferenceNotConfiguredError,
  ConferenceUnavailableError,
} from '@/server/conferencing/types'

const context = {
  title: 'Retainer planning',
  startsAt: new Date('2026-08-03T09:30:00Z'),
  endsAt: new Date('2026-08-03T10:30:00Z'),
  organiserEmail: 'owner@mediaclicks.ae',
  attendeeEmails: ['owner@mediaclicks.ae'],
  timezone: 'Asia/Dubai',
}

describe('the ConferenceProvider registry (§4.2)', () => {
  it('has an implementation for every provider in the enum', () => {
    // Total over the enum, so adding a value without an implementation is
    // caught here rather than at runtime on someone's meeting.
    for (const key of CONFERENCING_PROVIDER) {
      const provider = providerFor(key)
      expect(provider, key).toBeDefined()
      expect(provider.key).toBe(key)
    }
  })

  it('agrees with the schema about which platforms produce a link', () => {
    expect(providerFor('google_meet').generatesLink).toBe(true)
    expect(providerFor('zoom').generatesLink).toBe(true)
    expect(providerFor('whatsapp').generatesLink).toBe(false)
    expect(providerFor('none').generatesLink).toBe(false)
  })

  it('exposes the same three methods on every provider', () => {
    // The caller never branches, so every implementation must be callable
    // the same way — that is the entire point of the interface.
    for (const key of CONFERENCING_PROVIDER) {
      const provider = providerFor(key)
      expect(typeof provider.create).toBe('function')
      expect(typeof provider.update).toBe('function')
      expect(typeof provider.cancel).toBe('function')
    }
  })
})

describe('providers that do not create links', () => {
  it('returns a null url rather than throwing', async () => {
    // A null url is a legitimate result, not a failure. WhatsApp meetings are
    // held on WhatsApp; §4.3.1 requires no API at all.
    for (const key of ['whatsapp', 'none'] as const) {
      const details = await providerFor(key).create(context)
      expect(details).toEqual({ url: null, externalId: null })
    }
  })

  it('cancels without complaint when nothing was ever created', async () => {
    await expect(providerFor('whatsapp').cancel('anything')).resolves.toBeUndefined()
    await expect(providerFor('none').cancel('anything')).resolves.toBeUndefined()
  })

  it('keeps WhatsApp and none as separate implementations', () => {
    // Identical behaviour, deliberately not the same object: the UI shows a
    // phone number for one and nothing for the other.
    expect(providerFor('whatsapp')).not.toBe(providerFor('none'))
  })
})

describe('providers awaiting credentials', () => {
  it('reports itself unconfigured rather than failing opaquely', async () => {
    for (const key of ['google_meet', 'zoom'] as const) {
      await expect(providerFor(key).create(context)).rejects.toBeInstanceOf(
        ConferenceNotConfiguredError,
      )
    }
  })

  it('is a ConferenceUnavailableError, so callers keep the meeting', async () => {
    // §4.2: the caller treats missing credentials exactly like an outage —
    // save the meeting, offer a retry. It must not be a separate code path.
    await expect(providerFor('zoom').create(context)).rejects.toBeInstanceOf(
      ConferenceUnavailableError,
    )
  })
})

describe('retry with backoff (§7)', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = vi.fn(async () => {})
    const result = await withRetry(async () => 'ok', { sleep })
    expect(result).toBe('ok')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a transient failure and succeeds', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const result = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('502 bad gateway')
        return 'ok'
      },
      { sleep },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt limit', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw new Error('always down')
        },
        { attempts: 3, sleep },
      ),
    ).rejects.toThrow('always down')
    expect(calls).toBe(3)
  })

  it('does not retry what cannot succeed', async () => {
    // A 401 will not fix itself, and retrying it just delays the error.
    const sleep = vi.fn(async () => {})
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw new ConferenceNotConfiguredError('zoom', 'ZOOM_CLIENT_ID')
        },
        { retryable: (e) => !(e instanceof ConferenceNotConfiguredError), sleep },
      ),
    ).rejects.toBeInstanceOf(ConferenceNotConfiguredError)
    expect(calls).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('backs off exponentially and jitters', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms)
    })
    await expect(
      withRetry(
        async () => {
          throw new Error('down')
        },
        { attempts: 4, baseMs: 100, sleep },
      ),
    ).rejects.toThrow()

    expect(delays).toHaveLength(3)
    // Full jitter: each delay lands in [0, base * 2^attempt].
    expect(delays[0]).toBeLessThanOrEqual(100)
    expect(delays[1]).toBeLessThanOrEqual(200)
    expect(delays[2]).toBeLessThanOrEqual(400)
    expect(delays.every((d) => d >= 0)).toBe(true)
  })

  it('caps the delay', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms)
    })
    await expect(
      withRetry(
        async () => {
          throw new Error('down')
        },
        { attempts: 8, baseMs: 1000, maxMs: 2000, sleep },
      ),
    ).rejects.toThrow()
    expect(delays.every((d) => d <= 2000)).toBe(true)
  })
})
