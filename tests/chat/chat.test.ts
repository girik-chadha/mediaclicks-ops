import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { directMessageKey, normaliseChannelName } from '@/lib/chat/keys'

describe('direct message keys', () => {
  const a = '11111111-1111-4111-8111-111111111111'
  const b = '22222222-2222-4222-8222-222222222222'

  it('is the same whichever way round the pair is given', () => {
    // Two people clicking "message" on each other at the same moment must
    // converge on one conversation, not create two histories.
    expect(directMessageKey(a, b)).toBe(directMessageKey(b, a))
  })

  it('differs for different pairs', () => {
    const c = '33333333-3333-4333-8333-333333333333'
    expect(directMessageKey(a, b)).not.toBe(directMessageKey(a, c))
  })
})

describe('channel name normalisation', () => {
  it('folds case, so #Creative and #creative are one channel', () => {
    expect(normaliseChannelName('#Creative')).toBe('creative')
    expect(normaliseChannelName('creative')).toBe('creative')
  })

  it('strips leading hashes and surrounding space', () => {
    expect(normaliseChannelName('  ##media  ')).toBe('media')
  })

  it('replaces runs of punctuation and spaces with a single dash', () => {
    expect(normaliseChannelName('Q4 planning!!')).toBe('q4-planning')
    expect(normaliseChannelName('a   b')).toBe('a-b')
  })

  it('does not leave dangling dashes', () => {
    expect(normaliseChannelName('--edges--')).toBe('edges')
    expect(normaliseChannelName('!!!')).toBe('')
  })

  it('caps the length', () => {
    expect(normaliseChannelName('x'.repeat(200)).length).toBe(40)
  })
})

/* ── Schema guarantees, against a real Postgres ─────────────────────────── */

let pg: PGlite
const ORG = '00000000-0000-0000-0000-0000000000a1'
const ALICE = '00000000-0000-0000-0000-0000000000b1'
const BOB = '00000000-0000-0000-0000-0000000000b2'

beforeAll(async () => {
  pg = new PGlite()
  for (const file of ['drizzle/0000_init.sql', 'drizzle/0001_chat.sql']) {
    const sql = readFileSync(file, 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.exec(statement)
    }
  }
  await pg.exec(`
    INSERT INTO organisations (id, name) VALUES ('${ORG}', 'MediaClicks');
    INSERT INTO users (id, org_id, email, full_name) VALUES
      ('${ALICE}', '${ORG}', 'alice@mediaclicks.ae', 'Alice Adams'),
      ('${BOB}',   '${ORG}', 'bob@mediaclicks.ae',   'Bob Barker');
  `)
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

async function attempt(sql: string): Promise<string | null> {
  try {
    await pg.exec(sql)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

describe('channel shape constraints', () => {
  it('accepts a named channel with no dm key', async () => {
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, name) VALUES ('${ORG}', 'channel', 'creative')`,
      ),
    ).toBeNull()
  })

  it('rejects a named channel that also carries a dm key', async () => {
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, name, dm_key) VALUES ('${ORG}', 'channel', 'x', 'a:b')`,
      ),
    ).toMatch(/channels_shape/)
  })

  it('rejects a direct conversation with a name', async () => {
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, name, dm_key) VALUES ('${ORG}', 'direct', 'nope', 'a:b')`,
      ),
    ).toMatch(/channels_shape/)
  })

  it('rejects a direct conversation with no dm key', async () => {
    expect(
      await attempt(`INSERT INTO channels (org_id, kind) VALUES ('${ORG}', 'direct')`),
    ).toMatch(/channels_shape/)
  })

  it('rejects an unknown kind', async () => {
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, name) VALUES ('${ORG}', 'broadcast', 'x')`,
      ),
    ).toMatch(/channels_kind_valid/)
  })
})

describe('uniqueness', () => {
  it('allows only one conversation per pair', async () => {
    const key = directMessageKey(ALICE, BOB)
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, dm_key) VALUES ('${ORG}', 'direct', '${key}')`,
      ),
    ).toBeNull()
    // This is the race two simultaneous clicks would create.
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, dm_key) VALUES ('${ORG}', 'direct', '${key}')`,
      ),
    ).toMatch(/channels_dm_key_unq/)
  })

  it('allows only one channel per name', async () => {
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, name) VALUES ('${ORG}', 'channel', 'creative')`,
      ),
    ).toMatch(/channels_org_name_unq/)
  })

  it('does not let the name index collide with direct conversations', async () => {
    // The name index is partial (WHERE kind = 'channel'), so many direct
    // conversations with a null name must still coexist.
    const other = directMessageKey(ALICE, '00000000-0000-0000-0000-0000000000b9')
    expect(
      await attempt(
        `INSERT INTO channels (org_id, kind, dm_key) VALUES ('${ORG}', 'direct', '${other}')`,
      ),
    ).toBeNull()
  })
})

describe('messages', () => {
  it('rejects an empty or whitespace-only body', async () => {
    const [channel] = (
      await pg.query<{ id: string }>(`SELECT id FROM channels WHERE name = 'creative'`)
    ).rows
    const insert = (body: string) =>
      attempt(
        `INSERT INTO messages (org_id, channel_id, author_user_id, author_name, body)
         VALUES ('${ORG}', '${channel!.id}', '${ALICE}', 'Alice Adams', '${body}')`,
      )

    expect(await insert('   ')).toMatch(/messages_body_not_empty/)
    expect(await insert('hello')).toBeNull()
  })

  it('keeps the message when its author is deleted', async () => {
    const [channel] = (
      await pg.query<{ id: string }>(`SELECT id FROM channels WHERE name = 'creative'`)
    ).rows

    await pg.exec(`
      INSERT INTO users (id, org_id, email, full_name)
        VALUES ('00000000-0000-0000-0000-0000000000c9', '${ORG}', 'leaver@x.ae', 'Leaver Lee');
      INSERT INTO messages (org_id, channel_id, author_user_id, author_name, body)
        VALUES ('${ORG}', '${channel!.id}', '00000000-0000-0000-0000-0000000000c9', 'Leaver Lee', 'still here');
      DELETE FROM users WHERE id = '00000000-0000-0000-0000-0000000000c9';
    `)

    const res = await pg.query<{ author_user_id: string | null; author_name: string }>(
      `SELECT author_user_id, author_name FROM messages WHERE body = 'still here'`,
    )
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]!.author_user_id).toBeNull()
    // Denormalised, so the conversation still reads correctly afterwards.
    expect(res.rows[0]!.author_name).toBe('Leaver Lee')
  })

  it('removes messages when the channel goes', async () => {
    await pg.exec(
      `INSERT INTO channels (org_id, kind, name) VALUES ('${ORG}', 'channel', 'temp')`,
    )
    const [temp] = (
      await pg.query<{ id: string }>(`SELECT id FROM channels WHERE name = 'temp'`)
    ).rows
    await pg.exec(`
      INSERT INTO messages (org_id, channel_id, author_user_id, author_name, body)
        VALUES ('${ORG}', '${temp!.id}', '${ALICE}', 'Alice Adams', 'bye');
      DELETE FROM channels WHERE id = '${temp!.id}';
    `)
    const res = await pg.query(`SELECT 1 FROM messages WHERE body = 'bye'`)
    expect(res.rows).toHaveLength(0)
  })
})
