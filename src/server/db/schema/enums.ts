/**
 * Enumerated value sets.
 *
 * Deliberately NOT Postgres native enums — see docs/adr/0002-enum-strategy.md.
 * Each set is declared once here and consumed twice: by Drizzle's
 * `text(col, { enum })` for the TypeScript union, and by `oneOf()` for the
 * database CHECK constraint. One source, so the type and the constraint
 * cannot drift apart.
 */

export const MEETING_TYPE = ['client', 'internal'] as const
export type MeetingType = (typeof MEETING_TYPE)[number]

export const MEETING_STATUS = ['scheduled', 'cancelled', 'completed'] as const
export type MeetingStatus = (typeof MEETING_STATUS)[number]

/** §4.2. Grew from two values to four during specification — the reason this
 *  schema does not use native enums. */
export const CONFERENCING_PROVIDER = [
  'google_meet',
  'zoom',
  'whatsapp',
  'none',
] as const
export type ConferencingProvider = (typeof CONFERENCING_PROVIDER)[number]

export const ATTENDEE_RESPONSE = ['pending', 'accepted', 'declined'] as const
export type AttendeeResponse = (typeof ATTENDEE_RESPONSE)[number]

export const PREFERRED_CHANNEL = ['email', 'whatsapp'] as const
export type PreferredChannel = (typeof PREFERRED_CHANNEL)[number]

/** §4.2: drives the Meet/Zoom preselect. A preselect only — never a gate. */
export const CLIENT_REGION = ['domestic', 'international'] as const
export type ClientRegion = (typeof CLIENT_REGION)[number]

export const NOTIFICATION_TYPE = [
  'daily_digest',
  'meeting_reminder',
  'meeting_changed',
  'assigned_to_meeting',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPE)[number]

export const NOTIFICATION_CHANNEL = ['web_push', 'email'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number]
