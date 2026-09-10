/**
 * A first week of internal meetings for the real team.
 *
 * The demo dataset is gone at handover, and a calendar with nothing on it
 * reads as a product that does not work. This puts a handful of ordinary
 * agency meetings on the next two working weeks — standups, a planning
 * session, a creative review — attended by the people who actually exist,
 * created by the owner the team is being handed to.
 *
 *   node --import tsx scripts/starter-meetings.ts            (dry run)
 *   node --import tsx scripts/starter-meetings.ts --apply
 *
 * No clients, on purpose: every real client is a row the agency adds itself.
 * No tag in the description either — these are real meetings the owner can
 * rename, move or cancel like any other. They are placeholders in intent,
 * not in kind, and a "[demo]" label in front of the whole team would be the
 * thing the demo clear-out was meant to remove.
 *
 * Idempotent on (title, start): re-running adds nothing that already exists.
 */
import { config } from 'dotenv'
import { and, eq, inArray, notLike } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { meetingAttendees, meetings, users } from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

const CREATOR = 'minizfn12345@gmail.com'

/**
 * [working-day offset from next Monday, HH:MM local, minutes, title,
 *  provider, how many attendees besides the creator]
 *
 * Working days only, office hours in the creator's stored zone. Two weeks so
 * the second one is visible from the first — a single week ends in a cliff.
 */
const PLAN: readonly (readonly [number, string, number, string, 'google_meet' | 'zoom', number])[] = [
  [0, '09:30', 30, 'Weekly planning', 'google_meet', 6],
  [0, '15:00', 45, 'Creative review', 'zoom', 4],
  [1, '10:00', 15, 'Standup', 'google_meet', 8],
  [2, '10:00', 15, 'Standup', 'google_meet', 8],
  [2, '16:00', 30, 'Pipeline check', 'google_meet', 3],
  [3, '10:00', 15, 'Standup', 'google_meet', 8],
  [3, '14:30', 45, 'Content calendar', 'zoom', 5],
  [4, '10:00', 15, 'Standup', 'google_meet', 8],
  [4, '16:30', 30, 'Week wrap', 'google_meet', 6],
  [7, '09:30', 30, 'Weekly planning', 'google_meet', 6],
  [8, '10:00', 15, 'Standup', 'google_meet', 8],
  [9, '11:00', 60, 'Campaign retro', 'zoom', 5],
  [10, '10:00', 15, 'Standup', 'google_meet', 8],
  [11, '15:00', 45, 'Creative review', 'zoom', 4],
]

const hash = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
const letters = (s: string, n: number) =>
  [...Array(n)].map((_, i) => String.fromCharCode(97 + ((hash(s) >> (i * 3)) % 26))).join('')

/** Meet and Zoom need a link or the entry is one nobody can join. Derived
 *  from the title and start so a re-run reproduces the same link. */
function linkFor(provider: 'google_meet' | 'zoom', seed: string): string {
  if (provider === 'zoom') return `https://zoom.us/j/${88000000000 + (hash(seed) % 900000)}`
  return `https://meet.google.com/${letters(seed, 3)}-${letters(seed + 'x', 4)}-${letters(seed + 'y', 3)}`
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * Guess UTC, read back what that instant's wall clock is in the zone, and
 * shift by the difference. Correct across DST boundaries, and it does not
 * hardcode the zone's offset — the team's zone is a Profile setting, not a
 * constant.
 */
function atZone(y: number, m: number, d: number, hh: number, mm: number, zone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const seen = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
  return new Date(guess.getTime() - (seen - guess.getTime()))
}

/** Calendar date parts of "now" in a zone. */
function todayIn(zone: string): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  const db = drizzle(sql)

  try {
    const [creator] = await db
      .select({ id: users.id, orgId: users.orgId, timezone: users.timezone })
      .from(users)
      .where(eq(users.email, CREATOR))
      .limit(1)
    if (!creator) throw new Error(`No account for ${CREATOR}. Run scripts/add-team.ts first.`)

    // Everyone real and active in the org, in a stable order so the same
    // meeting gets the same room on every run.
    const team = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.orgId, creator.orgId),
          notLike(users.email, '%@mediaclicks.example'),
        ),
      )
      .orderBy(users.email)
    const others = team.filter((u) => u.id !== creator.id)
    if (others.length === 0) throw new Error('Nobody else on the team yet.')

    // Next Monday in the creator's zone. If today is Monday, next week's —
    // a meeting that starts in an hour on the day the team first signs in
    // is a surprise, not a welcome.
    const t = todayIn(creator.timezone)
    const daysToMonday = ((8 - t.weekday) % 7) || 7
    const base = new Date(Date.UTC(t.y, t.m - 1, t.d + daysToMonday))
    const dayOf = (offset: number) => {
      const d = new Date(base.getTime() + offset * 86_400_000)
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
    }

    const planned = PLAN.map(([offset, hhmm, minutes, title, provider, headcount]) => {
      const { y, m, d } = dayOf(offset)
      const [hh, mm] = hhmm.split(':').map(Number) as [number, number]
      const startsAt = atZone(y, m, d, hh, mm, creator.timezone)
      return {
        title,
        provider,
        startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * 60_000),
        headcount: Math.min(headcount, others.length),
      }
    })

    const existing = await db
      .select({ title: meetings.title, startsAt: meetings.startsAt })
      .from(meetings)
      .where(
        and(
          eq(meetings.orgId, creator.orgId),
          inArray(meetings.title, [...new Set(planned.map((p) => p.title))]),
        ),
      )
    const have = new Set(existing.map((e) => `${e.title}@${e.startsAt.getTime()}`))

    console.log(apply ? '\napplying:\n' : '\nDRY RUN — nothing will be written:\n')
    let made = 0
    let skipped = 0

    for (const p of planned) {
      const key = `${p.title}@${p.startsAt.getTime()}`
      const when = p.startsAt.toLocaleString('en-GB', {
        timeZone: creator.timezone, weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
      if (have.has(key)) {
        skipped++
        console.log(`  ${when}  ${p.title.padEnd(18)} exists, skipped`)
        continue
      }

      // A stable rotation of the team per title, so standups don't always
      // omit the same three people.
      const start = hash(p.title + p.startsAt.toISOString()) % others.length
      const room = [...others.slice(start), ...others.slice(0, start)].slice(0, p.headcount)
      console.log(`  ${when}  ${p.title.padEnd(18)} ${room.length + 1} people`)
      // Counted whether or not it is written — the dry run's totals have to
      // describe the rows it just listed, not the rows a different mode
      // would have inserted. Same mistake as add-team.ts once had.
      made++
      if (!apply) continue

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(meetings)
          .values({
            orgId: creator.orgId,
            title: p.title,
            description: null,
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            type: 'internal',
            clientId: null,
            createdByUserId: creator.id,
            conferencingProvider: p.provider,
            conferenceUrl: linkFor(p.provider, key),
            status: 'scheduled',
          })
          .returning({ id: meetings.id })

        await tx.insert(meetingAttendees).values([
          { meetingId: row!.id, userId: creator.id, response: 'accepted' as const },
          ...room.map((u) => ({ meetingId: row!.id, userId: u.id, response: 'pending' as const })),
        ])
      })
    }

    console.log(
      `\n${made} to create, ${skipped} already there` + (apply ? '.' : ' — re-run with --apply to write.'),
    )
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
