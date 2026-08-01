/**
 * The permission vocabulary (§3).
 *
 * These are global constants shipped with the code, not per-tenant data —
 * a key only means something because there is code that enforces it. The
 * `permissions` table exists so roles can reference keys by foreign key; the
 * seed reconciles it against this array.
 *
 * Roles are named bundles of these, and nothing in the codebase branches on a
 * role name. That is what lets the Owner define custom roles from the UI
 * without a deploy.
 */
export const PERMISSION_KEYS = [
  'meeting.create.own',
  'meeting.create.any',
  'meeting.edit.own',
  'meeting.edit.any',
  'meeting.delete.own',
  'meeting.delete.any',
  'meeting.view.own',
  'meeting.view.all',
  'transcript.view.own',
  'transcript.view.all',
  'client.manage',
  'user.invite',
  'user.manage',
  'role.manage',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export const SYSTEM_ROLE_NAMES = ['Owner', 'Manager', 'Member'] as const
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number]

/**
 * Seeded defaults (§3). Seed data only — never consulted at runtime by
 * `can()`, which reads the user's granted set from the database.
 *
 * Manager holds `user.invite`, so with these defaults a Manager can create
 * users. That is a seed-data decision and is revocable from the permissions
 * matrix without touching code.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<
  SystemRoleName,
  readonly PermissionKey[]
> = {
  Owner: PERMISSION_KEYS,

  Manager: PERMISSION_KEYS.filter(
    (k) => k !== 'role.manage' && k !== 'user.manage',
  ),

  Member: [
    'meeting.create.own',
    'meeting.edit.own',
    'meeting.delete.own',
    'meeting.view.own',
    'transcript.view.own',
    // §3 grants Member the whole team calendar deliberately: §4.1.2's
    // attendee filter is gated on it, and an agency scheduling around each
    // other needs to see each other.
    'meeting.view.all',
  ],
}
