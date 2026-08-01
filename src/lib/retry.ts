/**
 * Retry with exponential backoff and jitter (§7).
 *
 * Jitter matters more than the backoff curve: without it, every request that
 * failed during an outage retries at the same instants, and the recovering
 * service is hit by a synchronised wave from every client at once. Randomising
 * the delay spreads them out.
 */
export interface RetryOptions {
  attempts?: number
  baseMs?: number
  maxMs?: number
  /** Return false to give up immediately — a 401 will not fix itself. */
  retryable?: (error: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  const baseMs = options.baseMs ?? 250
  const maxMs = options.maxMs ?? 4000
  const retryable = options.retryable ?? (() => true)
  const sleep = options.sleep ?? defaultSleep

  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!retryable(error) || attempt === attempts - 1) break

      const backoff = Math.min(baseMs * 2 ** attempt, maxMs)
      // Full jitter: anywhere in [0, backoff]. Cheaper to reason about than
      // decorrelated jitter and just as effective at breaking synchronisation.
      await sleep(Math.random() * backoff)
    }
  }

  throw lastError
}
