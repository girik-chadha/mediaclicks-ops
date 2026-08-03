import type { Action } from '@/lib/permissions'

/**
 * The assistant's tool catalogue (§4.6).
 *
 * Pure, like src/lib/permissions: no database, no session, no SDK import.
 * That is what lets the permission test below iterate every tool against
 * every role without mocking anything.
 *
 * Two properties are declared here rather than left to each executor to
 * remember, because both are load-bearing:
 *
 *   `action`  — the permission the tool needs. Held as data so a test can
 *               assert, over the cartesian product of tools and roles, that
 *               a tool is reachable exactly when can() says the action is.
 *               A tool added later with no entry is a compile error, not a
 *               silently unguarded capability.
 *
 *   `effect`  — 'read' runs immediately; 'write' is *staged* and executes
 *               only after the human confirms. The distinction is a property
 *               of the tool, not a judgement the model makes at runtime.
 *
 * The toolset is fixed. The model cannot define new tools, and there is no
 * shell, no SQL, no fetch. Its entire reach is these seven functions.
 */

export const TOOL_NAMES = [
  'list_team',
  'list_my_meetings',
  'find_free_slot',
  'reschedule_meeting',
  'cancel_meeting',
  'reassign_meeting',
  'notify_user',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/** Only the subset of JSON Schema the API's strict mode accepts. */
interface Schema {
  /** JSON Schema allows further keys; declared so this stays structurally
   *  compatible with the SDK's InputSchema without a cast through unknown. */
  readonly [key: string]: unknown
  readonly type: 'object'
  readonly properties: Record<
    string,
    {
      type: 'string' | 'integer' | 'array'
      description: string
      items?: { type: 'string' }
    }
  >
  /** Mutable, because that is the shape the SDK's InputSchema type takes. */
  readonly required: string[]
  readonly additionalProperties: false
}

export interface ToolSpec {
  readonly name: ToolName
  readonly description: string
  readonly effect: 'read' | 'write'
  /**
   * Null means the tool needs no permission — not that it is unguarded.
   * Every executor is still org-scoped, so `list_team` cannot see another
   * organisation's people. It means only that no §3 key gates it, because
   * no key gates the equivalent click either: anyone can open the team list
   * or send a colleague a message.
   */
  readonly action: Action | null
  readonly input_schema: Schema
}

/**
 * Descriptions are written for the model, and say *when* to call the tool,
 * not just what it does. A description that only states the signature gets
 * a tool that fires at the wrong moment.
 */
export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'list_team',
    effect: 'read',
    action: null,
    description:
      'List everyone on the team with their user id. Call this first whenever ' +
      'the request names a person ("move Priya to Thursday"), because every ' +
      'other tool takes user ids, never names.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'list_my_meetings',
    effect: 'read',
    action: 'meeting.view',
    description:
      'List meetings in a date range that the current user is allowed to see, ' +
      'each with its meeting id. Call this before any reschedule, cancel or ' +
      'reassign — those take a meeting id, and guessing one is not possible.',
    input_schema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Start of the range, ISO 8601, inclusive. e.g. 2026-08-03T00:00:00Z',
        },
        to: {
          type: 'string',
          description: 'End of the range, ISO 8601, exclusive.',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_free_slot',
    effect: 'read',
    action: 'meeting.view',
    description:
      'Find times when everyone listed is free, within working hours on ' +
      'working days. Call this before proposing a new time, rather than ' +
      'picking one and hoping. Returns at most a handful of candidates.',
    input_schema: {
      type: 'object',
      properties: {
        user_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Everyone who must be free. Include the current user if they attend.',
        },
        duration_minutes: {
          type: 'integer',
          description: 'How long the meeting needs to be.',
        },
        within_days: {
          type: 'integer',
          description: 'How many days ahead to search. 7 unless the request says otherwise.',
        },
      },
      required: ['user_ids', 'duration_minutes', 'within_days'],
      additionalProperties: false,
    },
  },
  {
    name: 'reschedule_meeting',
    effect: 'write',
    action: 'meeting.edit',
    description:
      'Move a meeting to a new time. Staged for the user to confirm — calling ' +
      'this changes nothing by itself. Confirm the slot is free with ' +
      'find_free_slot first unless the user named an exact time.',
    input_schema: {
      type: 'object',
      properties: {
        meeting_id: { type: 'string', description: 'From list_my_meetings.' },
        starts_at: { type: 'string', description: 'New start, ISO 8601.' },
        ends_at: { type: 'string', description: 'New end, ISO 8601.' },
      },
      required: ['meeting_id', 'starts_at', 'ends_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_meeting',
    effect: 'write',
    action: 'meeting.delete',
    description:
      'Cancel a meeting. Staged for the user to confirm. The meeting is marked ' +
      'cancelled rather than deleted, and its pending reminders are dropped.',
    input_schema: {
      type: 'object',
      properties: {
        meeting_id: { type: 'string', description: 'From list_my_meetings.' },
        reason: {
          type: 'string',
          description: 'Short reason, recorded in the audit log. Empty string if none was given.',
        },
      },
      required: ['meeting_id', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'reassign_meeting',
    effect: 'write',
    action: 'meeting.edit',
    description:
      'Swap one attendee for another on a meeting, leaving everyone else in ' +
      'place. Staged for the user to confirm. Use this for "Priya can\'t make ' +
      'it, send Arjun instead" — not reschedule_meeting.',
    input_schema: {
      type: 'object',
      properties: {
        meeting_id: { type: 'string', description: 'From list_my_meetings.' },
        from_user_id: { type: 'string', description: 'The attendee being removed.' },
        to_user_id: { type: 'string', description: 'The attendee taking their place.' },
      },
      required: ['meeting_id', 'from_user_id', 'to_user_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'notify_user',
    effect: 'write',
    action: null,
    description:
      'Send someone a direct message from the current user. Staged for the ' +
      'user to confirm. Use it to tell a colleague about a change you are ' +
      'also making — not to announce something you have not done.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'From list_team.' },
        message: {
          type: 'string',
          description: 'What to say. One or two sentences, written as the current user.',
        },
      },
      required: ['user_id', 'message'],
      additionalProperties: false,
    },
  },
]

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export function toolSpec(name: string): ToolSpec | undefined {
  return BY_NAME.get(name as ToolName)
}

/** Working hours used by find_free_slot. The team is in one place (IST). */
export const WORK_START_MINUTE = 9 * 60
export const WORK_END_MINUTE = 18 * 60
/** Sunday = 0. Saturday and Sunday are not offered. */
export const WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5]
