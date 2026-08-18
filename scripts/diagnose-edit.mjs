/**
 * Why did an edit not stick?
 *
 * Run this straight after saving an edit that appeared to work:
 *
 *   node scripts/diagnose-edit.mjs
 *
 * It answers one question the UI cannot: did `updateMeeting` actually run?
 * Every write in that function shares a transaction with an audit row, so an
 * audit row is proof the transaction committed, and its absence is proof the
 * function was never reached. Those two cases have completely different
 * causes, and guessing between them from the outside wastes everyone's time.
 */
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const url = /DATABASE_URL\s*=\s*"([^"]+)"/.exec(env)?.[1]
if (!url) {
  console.error('No DATABASE_URL in .env.local')
  process.exit(1)
}

// Same rule as src/server/db/index.ts: the transaction pooler cannot keep
// named prepared statements across statements.
const sql = postgres(url, { prepare: new URL(url).port !== '6543', max: 2 })

try {
  const audit = await sql`
    select action, entity_id, actor_email, agent_initiated, created_at
    from audit_log
    where action like 'meeting.%'
    order by created_at desc
    limit 10`

  console.log('\n=== last 10 meeting audit rows ===')
  if (audit.length === 0) {
    console.log('(none at all — no meeting has ever been written through the app)')
  }
  for (const r of audit) {
    console.log(
      `${r.created_at.toISOString()}  ${r.action.padEnd(16)}  ${r.entity_id}  ${r.actor_email}`,
    )
  }

  const updates = audit.filter((r) => r.action === 'meeting.updated')
  console.log(`\nmeeting.updated rows in that window: ${updates.length}`)

  console.log('\n=== 8 most recently created meetings ===')
  const rows = await sql`
    select m.id, m.title, m.starts_at, m.ends_at, m.conferencing_provider,
           m.status, m.created_at,
           (select count(*) from meeting_attendees a where a.meeting_id = m.id) as attendees
    from meetings m
    order by m.created_at desc
    limit 8`
  for (const r of rows) {
    console.log(
      `${r.created_at.toISOString()}  ${String(r.title).slice(0, 28).padEnd(28)}  ` +
        `starts ${r.starts_at.toISOString()}  ${r.conferencing_provider}  ` +
        `${r.attendees} attendee(s)  ${r.status}`,
    )
  }

  console.log(`
=== how to read this ===
A 'meeting.updated' row from the moment you pressed Save means the write
committed, and the problem is that the row it targeted was not the meeting
you were looking at.

No 'meeting.updated' row means updateMeeting was never reached. If you also
see a brand-new meeting at the top of the list with your edited title, the
form submitted to createMeetingAction instead of updateMeetingAction — the
edit became a second meeting and the original was quite correctly left alone.
`)
} catch (error) {
  console.error('Could not reach the database:', error.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
