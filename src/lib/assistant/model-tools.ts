import { TOOLS, type ToolName } from './tools'

/**
 * The same toolset in the shape a model's function-calling API wants.
 *
 * Pure, like the rest of src/lib/assistant: no database, no session, no
 * fetch. That is what lets `tests/assistant/llm-planner.test.ts` hold these
 * definitions against the real catalogue in `tools.ts` without standing up
 * an environment — the same reason the permission matrix is testable.
 *
 * Nothing here grants anything. A definition is a description handed to a
 * model; the tool it names still runs through `runTool`, which is where
 * `requirePermission` lives and where a write is turned into a staged
 * proposal instead of an effect (ADR 0007).
 */

export interface ModelToolDef {
  readonly type: 'function'
  readonly function: {
    readonly name: ToolName
    readonly description: string
    readonly parameters: {
      readonly type: 'object'
      readonly properties: Record<string, unknown>
      readonly required?: readonly string[]
      readonly additionalProperties: boolean
    }
  }
}

/**
 * Whether a model is configured at all.
 *
 * Reads the key rather than being passed it, so the answer is the same
 * everywhere it is asked. Next.js does not expose an env var to the browser
 * unless it is prefixed NEXT_PUBLIC_, so this is `false` on the client and
 * the key itself never crosses — but nothing on the client asks.
 */
export function modelAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

/**
 * `request_approval` is deliberately absent.
 *
 * It is built by the planner out of a write the person was not allowed to
 * make, and `runTool` refuses it by name. Offering it to a model would be
 * offering a way to file an approval request for a change whose permission
 * nobody checked.
 */
export const MODEL_TOOL_DEFS: readonly ModelToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_team',
      description:
        'Lists everyone in the organisation with their user id. Call this before referring to anyone by id.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clients',
      description: 'Lists every client on file with their client id.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_meetings',
      description:
        'Lists meetings visible to the caller within a date range, with meeting ids, attendees and times.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO 8601 start of range' },
          to: { type: 'string', description: 'ISO 8601 end of range' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_free_slot',
      description:
        'Finds open slots of a given length for a set of people, within working hours (09:00-18:00, Monday to Friday).',
      parameters: {
        type: 'object',
        properties: {
          user_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'User ids to check availability for',
          },
          duration_minutes: { type: 'integer' },
          within_days: { type: 'integer', description: 'How many days ahead to search' },
        },
        required: ['user_ids', 'duration_minutes', 'within_days'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_meeting',
      description:
        'Stages a new meeting for the human to confirm. Does not create it — nothing exists until they click Confirm.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          starts_at: { type: 'string', description: 'ISO 8601' },
          ends_at: { type: 'string', description: 'ISO 8601' },
          attendee_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'User ids. Include the caller unless told otherwise.',
          },
          client_id: { type: 'string', description: 'Empty string for an internal meeting' },
          provider: { type: 'string', enum: ['google_meet', 'zoom', 'whatsapp', 'none'] },
          url: {
            type: 'string',
            description:
              'Join link. Required when provider is google_meet or zoom. Never invent one — ask for it.',
          },
        },
        required: ['title', 'starts_at', 'ends_at', 'attendee_ids', 'provider'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_meeting',
      description:
        'Stages moving an existing meeting to a new time. Does not move it — the human confirms.',
      parameters: {
        type: 'object',
        properties: {
          meeting_id: { type: 'string' },
          starts_at: { type: 'string', description: 'ISO 8601' },
          ends_at: { type: 'string', description: 'ISO 8601' },
        },
        required: ['meeting_id', 'starts_at', 'ends_at'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_meeting',
      description: 'Stages cancelling a meeting. Does not cancel it — the human confirms.',
      parameters: {
        type: 'object',
        properties: {
          meeting_id: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['meeting_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reassign_meeting',
      description:
        'Stages swapping one attendee for another on a meeting. Does not change it — the human confirms.',
      parameters: {
        type: 'object',
        properties: {
          meeting_id: { type: 'string' },
          from_user_id: { type: 'string' },
          to_user_id: { type: 'string' },
        },
        required: ['meeting_id', 'from_user_id', 'to_user_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_user',
      description: 'Stages a chat message to a teammate. Does not send it — the human confirms.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['user_id', 'message'],
        additionalProperties: false,
      },
    },
  },
]

/** Guards against a tool being added to the catalogue and forgotten here. */
export const MODEL_REACHABLE: readonly ToolName[] = TOOLS.map((t) => t.name).filter(
  (n) => n !== 'request_approval',
)
