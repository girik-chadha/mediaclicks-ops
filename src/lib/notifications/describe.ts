/**
 * How long the reminder worker has been silent, in words.
 *
 * Pure, and separate from the query that produces the number, for the same
 * reason `can()` is separate from the session: a sentence a person reads is
 * worth testing, and it should not need a database to test it.
 *
 * "90 minutes" and "2 days" want to read differently to someone deciding
 * whether this is a blip or something to go and fix.
 */
export function describeDelay(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.round(hours / 24)} days`
}
