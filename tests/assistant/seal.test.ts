import { beforeAll, describe, expect, it } from 'vitest'
import type { StagedAction } from '@/lib/assistant/plan'

// seal() reads AUTH_SECRET at call time, so setting it here is enough.
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-not-a-real-one'
})

const { seal, unseal, SealError } = await import('@/server/assistant/seal')

const ME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SOMEONE_ELSE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const PLAN: StagedAction[] = [
  {
    tool: 'cancel_meeting',
    input: { meeting_id: '33333333-3333-3333-3333-333333333333', reason: 'client rescheduled' },
    verb: 'Cancel',
    what: 'Miniz weekly, 15:00',
  },
]

describe('the confirmation seal', () => {
  it('round-trips a plan unchanged', () => {
    expect(unseal(seal(ME, PLAN), ME)).toEqual(PLAN)
  })

  it('rejects a plan whose contents were edited', () => {
    const token = seal(ME, PLAN)
    const [payload, signature] = token.split('.')

    const tampered = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
    tampered.actions[0].input.meeting_id = '44444444-4444-4444-4444-444444444444'

    const forged =
      Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url') + '.' + signature

    expect(() => unseal(forged, ME)).toThrow(SealError)
  })

  it('rejects a plan signed with a different secret', () => {
    const token = seal(ME, PLAN)
    process.env.AUTH_SECRET = 'a-different-secret'
    try {
      expect(() => unseal(token, ME)).toThrow(SealError)
    } finally {
      process.env.AUTH_SECRET = 'test-secret-not-a-real-one'
    }
  })

  it('rejects a plan belonging to someone else', () => {
    // Confirming is an act by a person, not a browser. A plan lifted from
    // one session must not execute in another.
    expect(() => unseal(seal(ME, PLAN), SOMEONE_ELSE)).toThrow(/someone else/)
  })

  it('rejects a plan that has expired', () => {
    const token = seal(ME, PLAN)
    const [payload, signature] = token.split('.')
    const envelope = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))

    // Expiry is inside the signed payload, so moving it forges the signature
    // too — which is the point. The message therefore reports tampering, not
    // expiry, and both refuse.
    envelope.expiresAt = Date.now() - 1
    const stale =
      Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url') + '.' + signature

    expect(() => unseal(stale, ME)).toThrow(SealError)
  })

  it('rejects rubbish without throwing something unhelpful', () => {
    for (const junk of ['', 'nonsense', 'a.b', '....']) {
      expect(() => unseal(junk, ME)).toThrow(SealError)
    }
  })
})
