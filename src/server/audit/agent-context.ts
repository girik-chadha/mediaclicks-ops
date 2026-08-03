import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Marks the current async context as agent-initiated (§4.6).
 *
 * The alternative was an `agentInitiated` parameter on every mutation. That
 * gets the flag right on the day it is written and wrong the first time
 * someone adds a mutation, or a code path the assistant reaches through
 * indirectly — and a missing flag is invisible: the audit row still looks
 * correct, it just claims a person did something an agent did.
 *
 * Ambient context inverts that. The assistant wraps its execution once, and
 * every audit row written underneath is flagged, including ones written by
 * code that has never heard of the assistant. There is no per-call-site
 * discipline to maintain.
 *
 * The actor is deliberately unchanged: §4.6 requires the human as
 * actor_user_id, with this only as an extra dimension. Nobody gets to hide
 * behind "the assistant did it".
 */
const store = new AsyncLocalStorage<true>()

export function asAgent<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(true, fn)
}

export function agentInitiated(): boolean {
  return store.getStore() ?? false
}
