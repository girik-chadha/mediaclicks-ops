import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Applies the real migration to an embedded Postgres and asserts the
 * guarantees the schema is supposed to provide.
 *
 * These test the *database*, not application code — deliberately. A CHECK
 * constraint or a NULLS NOT DISTINCT clause that was never executed is a
 * belief, not a guarantee, and the whole argument for putting these rules in
 * the schema is that application code cannot be trusted to remember them.
 *
 * PGlite is Postgres 16 compiled to WASM, so CI needs no database service.
 */

let pg: PGlite

const ORG = '00000000-0000-0000-0000-0000000000a1'
const USER = '00000000-0000-0000-0000-0000000000b1'
const OTHER = '00000000-0000-0000-0000-0000000000b2'
const CLIENT = '00000000-0000-0000-0000-0000000000c1'

beforeAll(async () => {
  pg = new PGlite()

  const sql = readFileSync('drizzle/0000_init.sql', 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await pg.exec(statement)
  }

  await pg.exec(`
    INSERT INTO organisations (id, name) VALUES ('${ORG}', 'MediaClicks');
    INSERT INTO users (id, org_id, email, full_name)
      VALUES ('${USER}', '${ORG}', 'owner@mediaclicks.ae', 'Owner'),
             ('${OTHER}', '${ORG}', 'other@mediaclicks.ae', 'Other');
    INSERT INTO clients (id, org_id, company_name)
      VALUES ('${CLIENT}', '${ORG}', 'Nuvel Cosmetics');
  `)
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

/** Inserts a meeting, returning the error message if Postgres rejected it. */
async function insertMeeting(fields: Record<string, string>): Promise<string | null> {
  const base: Record<string, string> = {
    org_id: `'${ORG}'`,
    title: `'Retainer planning'`,
    starts_at: `'2026-08-03T09:30:00Z'`,
    ends_at: `'2026-08-03T10:30:00Z'`,
    type: `'internal'`,
    created_by_user_id: `'${USER}'`,
    ...fields,
  }
  const cols = Object.keys(base).join(', ')
  const vals = Object.values(base).join(', ')
  try {
    await pg.exec(`INSERT INTO meetings (${cols}) VALUES (${vals});`)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

describe('migration', () => {
  it('applies cleanly and creates all 13 tables', async () => {
    const res = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    )
    const names = res.rows.map((r) => r.table_name)
    expect(names).toEqual([
      'audit_log',
      'clients',
      'meeting_attendees',
      'meeting_summaries',
      'meeting_transcripts',
      'meetings',
      'notifications',
      'organisations',
      'permissions',
      'role_permissions',
      'roles',
      'user_roles',
      'users',
    ])
  })

  it('stores every timestamp as timestamptz, with no exceptions', async () => {
    const res = await pg.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'`,
    )
    expect(res.rows.length).toBeGreaterThan(0)
    const naive = res.rows.filter((r) => r.data_type !== 'timestamp with time zone')
    expect(naive).toEqual([])
  })
})

describe('CHECK constraints (ADR 0002 — text + CHECK instead of pgEnum)', () => {
  it('rejects a value outside the conferencing provider set', async () => {
    const err = await insertMeeting({ conferencing_provider: `'microsoft_teams'` })
    expect(err).toMatch(/meetings_provider_valid/)
  })

  it('accepts every value inside the set', async () => {
    for (const p of ['google_meet', 'zoom', 'whatsapp', 'none']) {
      expect(await insertMeeting({ conferencing_provider: `'${p}'` })).toBeNull()
    }
  })

  it('rejects a meeting that ends before it starts', async () => {
    const err = await insertMeeting({
      starts_at: `'2026-08-03T10:30:00Z'`,
      ends_at: `'2026-08-03T09:30:00Z'`,
    })
    expect(err).toMatch(/meetings_time_order/)
  })

  it('rejects a zero-length meeting', async () => {
    const err = await insertMeeting({
      starts_at: `'2026-08-03T09:30:00Z'`,
      ends_at: `'2026-08-03T09:30:00Z'`,
    })
    expect(err).toMatch(/meetings_time_order/)
  })

  it('rejects a client meeting with no client (§4.1.1)', async () => {
    const err = await insertMeeting({ type: `'client'` })
    expect(err).toMatch(/meetings_client_link/)
  })

  it('rejects an internal meeting that carries a client (§4.1.1)', async () => {
    const err = await insertMeeting({ type: `'internal'`, client_id: `'${CLIENT}'` })
    expect(err).toMatch(/meetings_client_link/)
  })

  it('accepts a client meeting with a client', async () => {
    expect(await insertMeeting({ type: `'client'`, client_id: `'${CLIENT}'` })).toBeNull()
  })
})

describe('notification idempotency (§4.4)', () => {
  async function enqueue(type: string, meetingId: string | null): Promise<string | null> {
    const m = meetingId ? `'${meetingId}'` : 'NULL'
    try {
      await pg.exec(`
        INSERT INTO notifications (org_id, user_id, meeting_id, type, channel, scheduled_for)
        VALUES ('${ORG}', '${USER}', ${m}, '${type}', 'email', '2026-08-04T08:00:00Z');
      `)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  it('blocks a duplicate meeting reminder', async () => {
    const meeting = await pg.query<{ id: string }>(`SELECT id FROM meetings LIMIT 1`)
    const id = meeting.rows[0]!.id
    expect(await enqueue('meeting_reminder', id)).toBeNull()
    expect(await enqueue('meeting_reminder', id)).toMatch(/notifications_idempotency_unq/)
  })

  it('blocks a duplicate daily digest, where meeting_id is NULL', async () => {
    // The case NULLS NOT DISTINCT exists for. Postgres treats each NULL as
    // distinct by default, so without it this second insert would succeed and
    // the user would be emailed their digest twice on a worker restart —
    // precisely what the constraint is meant to prevent.
    expect(await enqueue('daily_digest', null)).toBeNull()
    expect(await enqueue('daily_digest', null)).toMatch(/notifications_idempotency_unq/)
  })

  it('confirms the index is declared NULLS NOT DISTINCT', async () => {
    const res = await pg.query<{ def: string }>(
      `SELECT indexdef AS def FROM pg_indexes
       WHERE indexname = 'notifications_idempotency_unq'`,
    )
    expect(res.rows[0]?.def).toContain('NULLS NOT DISTINCT')
  })
})

describe('delete policy (ADR 0004)', () => {
  it('keeps audit entries when their actor is deleted, nulling the reference', async () => {
    await pg.exec(`
      INSERT INTO users (id, org_id, email, full_name)
        VALUES ('00000000-0000-0000-0000-0000000000b9', '${ORG}', 'leaver@mediaclicks.ae', 'Leaver');
      INSERT INTO audit_log (org_id, actor_user_id, actor_email, action, entity_type)
        VALUES ('${ORG}', '00000000-0000-0000-0000-0000000000b9', 'leaver@mediaclicks.ae',
                'meeting.cancelled', 'meeting');
      DELETE FROM users WHERE id = '00000000-0000-0000-0000-0000000000b9';
    `)

    const res = await pg.query<{ actor_user_id: string | null; actor_email: string | null }>(
      `SELECT actor_user_id, actor_email FROM audit_log WHERE action = 'meeting.cancelled'`,
    )

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]!.actor_user_id).toBeNull()
    // The row must still say who. This is why actor_email is denormalised.
    expect(res.rows[0]!.actor_email).toBe('leaver@mediaclicks.ae')
  })

  it('refuses to delete a user who authored a meeting', async () => {
    await expect(pg.exec(`DELETE FROM users WHERE id = '${USER}';`)).rejects.toThrow(
      /meetings_created_by_user_id_users_id_fk/,
    )
  })

  it('refuses to delete a client with meetings on record', async () => {
    await expect(pg.exec(`DELETE FROM clients WHERE id = '${CLIENT}';`)).rejects.toThrow(
      /meetings_client_id_clients_id_fk/,
    )
  })

  it('removes a user from attendee lists without touching the meeting', async () => {
    const meeting = await pg.query<{ id: string }>(`SELECT id FROM meetings LIMIT 1`)
    const id = meeting.rows[0]!.id
    await pg.exec(`
      INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ('${id}', '${OTHER}');
      DELETE FROM users WHERE id = '${OTHER}';
    `)

    const attendees = await pg.query(`SELECT 1 FROM meeting_attendees WHERE user_id = '${OTHER}'`)
    const meetings = await pg.query(`SELECT 1 FROM meetings WHERE id = '${id}'`)
    expect(attendees.rows).toHaveLength(0)
    expect(meetings.rows).toHaveLength(1)
  })
})
