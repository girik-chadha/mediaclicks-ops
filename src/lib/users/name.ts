/**
 * Names: the one place that decides what to call somebody.
 *
 * Pure, so the fallback chain the greeting relies on is a tested fact
 * rather than a `??` somewhere in a page component that nobody will look at
 * until it renders "Hello, undefined."
 */

export interface NameParts {
  readonly firstName: string
  readonly lastName: string | null
}

/**
 * What the greeting calls you.
 *
 * `first_name` is NOT NULL, but a blank string can still arrive from an
 * older row or a bad import, and the greeting must never print an empty
 * "Hello, ." — so the chain continues to the part of the address before
 * the @, and finally to "there". "Hello, there." is a slightly odd
 * sentence; "Hello, ." is a broken product.
 */
export function displayFirstName(firstName: string | null | undefined, email: string): string {
  const first = (firstName ?? '').trim()
  if (first) return first

  const local = email.split('@')[0]?.trim() ?? ''
  if (local) return local

  return 'there'
}

/**
 * Splits a single "Full Name" on its first space.
 *
 * Only for the one-time backfill and for scripts that still take a whole
 * name. It is deliberately naive — "Mary Anne Smith" becomes first "Mary",
 * last "Anne Smith" — because there is no correct general rule, and the
 * person fixes it in Profile with two fields in front of them. A single
 * token becomes a first name with no last name, which is what most of this
 * team actually has.
 */
export function splitFullName(full: string): NameParts {
  const trimmed = full.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { firstName: '', lastName: null }

  const space = trimmed.indexOf(' ')
  if (space === -1) return { firstName: trimmed, lastName: null }

  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) }
}

/** The inverse, for anywhere that still wants one string. Matches the
 *  database's generated column exactly, so the two never disagree. */
export function joinName(parts: NameParts): string {
  return `${parts.firstName} ${parts.lastName ?? ''}`.trim()
}
