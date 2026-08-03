import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { StagedAction } from '@/lib/assistant/plan'

/**
 * Signs the staged plan so that confirming executes exactly what was shown.
 *
 * The plan makes a round trip through the browser between "here is what I
 * will do" and "yes, do it". Without a signature the confirm endpoint would
 * be executing a list of actions supplied by the client.
 *
 * That is not a privilege-escalation hole — every action re-runs
 * requirePermission() on execution, so a forged plan still cannot exceed
 * what the person could do by clicking. What the signature buys is the
 * property the confirmation button actually claims: that the thing being
 * confirmed is the thing that was proposed. A confirmation dialog you can
 * lie to is theatre.
 *
 * Bound to the actor and to a short expiry, so a captured plan cannot be
 * replayed by someone else or a day later.
 */

const TTL_MS = 15 * 60_000

interface Envelope {
  readonly actorId: string
  readonly expiresAt: number
  readonly actions: readonly StagedAction[]
}

export class SealError extends Error {
  override readonly name = 'SealError'
  constructor(message: string) {
    super(message)
  }
}

function secret(): string {
  // Same secret that signs the session cookie: if it is missing, the app has
  // no working auth either, so there is nothing to degrade gracefully into.
  const value = process.env.AUTH_SECRET
  if (!value) throw new SealError('AUTH_SECRET is not set')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function seal(actorId: string, actions: readonly StagedAction[]): string {
  const envelope: Envelope = {
    actorId,
    expiresAt: Date.now() + TTL_MS,
    actions,
  }
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function unseal(token: string, actorId: string): readonly StagedAction[] {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) throw new SealError('That plan is no longer valid.')

  const payload = token.slice(0, dot)
  const provided = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(payload), 'base64url')

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new SealError('That plan is no longer valid.')
  }

  const envelope = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Envelope

  // Checked after the signature, so a tampered envelope never reaches here
  // and these two are about a genuine plan going stale or being handed on.
  if (envelope.actorId !== actorId) throw new SealError('That plan belongs to someone else.')
  if (envelope.expiresAt < Date.now()) {
    throw new SealError('That plan has expired. Ask again and confirm the new one.')
  }

  return envelope.actions
}
