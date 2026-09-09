import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The login grant is the one thing standing between "a code was accepted"
 * and "a session exists". If it can be forged, the second factor is
 * decorative — so every one of these is an attempt to forge one.
 */

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-for-grant-signing-only'
})

const load = async () => import('@/server/auth/grant')

describe('a genuine grant', () => {
  it('round-trips the user and the device choice', async () => {
    const { sealGrant, openGrant } = await load()
    const opened = openGrant(sealGrant('user-123', true))
    expect(opened?.userId).toBe('user-123')
    expect(opened?.remember).toBe(true)
  })

  it('carries remember: false distinctly', async () => {
    const { sealGrant, openGrant } = await load()
    expect(openGrant(sealGrant('user-123', false))?.remember).toBe(false)
  })
})

describe('forgery', () => {
  it('rejects a tampered payload', async () => {
    const { sealGrant, openGrant } = await load()
    const token = sealGrant('user-123', false)
    const [payload, sig] = token.split('.')

    // Re-encode the body claiming a different user, keeping the signature.
    const forged = Buffer.from(
      JSON.stringify({
        userId: 'someone-else',
        remember: true,
        expiresAt: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url')

    expect(openGrant(`${forged}.${sig}`)).toBeNull()
    // Sanity: the untampered one still opens, so the null above is the
    // tampering and not a broken test.
    expect(openGrant(`${payload}.${sig}`)).not.toBeNull()
  })

  it('rejects an unsigned payload', async () => {
    const { openGrant } = await load()
    const payload = Buffer.from(
      JSON.stringify({ userId: 'x', remember: true, expiresAt: Date.now() + 60_000 }),
      'utf8',
    ).toString('base64url')
    expect(openGrant(payload)).toBeNull()
    expect(openGrant(`${payload}.`)).toBeNull()
    expect(openGrant(`${payload}.not-a-signature`)).toBeNull()
  })

  it('rejects a grant signed with a different secret', async () => {
    vi.resetModules()
    process.env.AUTH_SECRET = 'attacker-secret'
    const { sealGrant } = await import('@/server/auth/grant')
    const forged = sealGrant('user-123', true)

    vi.resetModules()
    process.env.AUTH_SECRET = 'test-secret-for-grant-signing-only'
    const { openGrant } = await import('@/server/auth/grant')

    expect(openGrant(forged)).toBeNull()
  })

  it('rejects junk', async () => {
    const { openGrant } = await load()
    for (const junk of ['', '.', 'a.b', 'not-base64.$$$', '....']) {
      expect(openGrant(junk)).toBeNull()
    }
  })
})

describe('expiry', () => {
  it('refuses a grant older than its sixty seconds', async () => {
    const { sealGrant, openGrant } = await load()
    const token = sealGrant('user-123', true)

    expect(openGrant(token)).not.toBeNull()

    // 61 seconds later.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    expect(openGrant(token)).toBeNull()
    vi.restoreAllMocks()
  })
})
