/**
 * Pure naming and keying rules for chat.
 *
 * Kept out of src/server for the same reason `can()` is: these are decisions,
 * not plumbing. Behind the server boundary they would drag in the database
 * client and env validation, so testing "does #Creative fold to #creative"
 * would need a DATABASE_URL — which is absurd for a string function.
 */

/**
 * A deterministic, order-independent key for a two-person conversation.
 *
 * Sorting is what makes it order-independent, and that is the whole point:
 * two people clicking "message" on each other at the same moment must
 * converge on one conversation rather than creating two divergent histories.
 * The unique index on (org_id, dm_key) turns that into a guarantee.
 */
export function directMessageKey(a: string, b: string): string {
  return [a, b].sort().join(':')
}

/**
 * Normalises a channel name so `#Creative`, `Creative` and `creative` are the
 * same channel rather than three near-identical ones nobody can tell apart.
 */
export function normaliseChannelName(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
