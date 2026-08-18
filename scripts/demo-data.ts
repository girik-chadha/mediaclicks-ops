/**
 * Fills an install with the design's own dataset, so every screen has
 * something to draw and the app can be put side by side with the design.
 *
 *   npm run db:demo          insert
 *   npm run db:demo -- clear remove everything this script created
 *
 * The people, clients, meetings and times are lifted from
 * docs/design-source.dc.html rather than invented.
 *
 * Everything is tagged — meetings in `description`, clients in `notes`,
 * people in `avatar_url` — so `clear` removes exactly what was added and can
 * never touch a real row. That matters more than usual here: this runs
 * against whatever DATABASE_URL points at, which in this project is the
 * deployed database.
 */
import { config } from 'dotenv'
import { and, eq, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { hashPassword } from '../src/server/auth/password'
import {
  clients,
  meetingAttendees,
  meetings,
  roles,
  userRoles,
  users,
} from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

const TAG = '[demo]'

/** Only ever set by `-- with-logins`, and only outside production. */
const DEMO_PASSWORD = 'demo-password-12345'

/** The design's roster, minus the founder — that is whoever seeded the org. */
const PEOPLE = [
  { name: 'Omar Khalil', title: 'Account Manager', role: 'Manager' },
  { name: 'Sara Deeb', title: 'Media Buyer', role: 'Member' },
  { name: 'Emma Fischer', title: 'Designer', role: 'Member' },
  { name: 'Mo Farouk', title: 'Media Buyer', role: 'Member' },
  { name: 'Lina Tarek', title: 'Account Manager', role: 'Manager' },
] as const

/** The design's five clients, verbatim. */
const CLIENTS = [
  { name: 'Nuvel Cosmetics', contact: 'Dina Aziz', email: 'dina@nuvel.ae', phone: '+971 4 388 2210', region: 'domestic' },
  { name: 'Kite Airlines', contact: 'Peter Lund', email: 'p.lund@kite.eu', phone: '+44 20 7946 0021', region: 'international' },
  { name: 'Fern & Field', contact: 'Maya Rahal', email: 'maya@fernfield.co', phone: '+971 4 552 8890', region: 'domestic' },
  { name: 'Al Barsha Motors', contact: 'Yusuf Nasser', email: 'yusuf@abmotors.ae', phone: '+971 4 701 1180', region: 'domestic' },
  { name: 'Orbit Fitness', contact: 'Tara Voss', email: 'tara@orbitfit.com', phone: '+1 415 555 0138', region: 'international' },
] as const

/**
 * The design's week: [weekday 0=Mon, hour, minute, minutes, title, client,
 * platform]. Copied from the `synth` array in the design source.
 *
 * One translation. The design gives "Budget approval" a TEL platform, and
 * §4.1.1 offers a client meeting only WhatsApp, Meet or Zoom — a client call
 * has to reach the client somehow. Mapped to WhatsApp, the one that is also
 * a phone call.
 */
const WEEK: readonly (readonly [
  number,
  number,
  number,
  number,
  string,
  string | null,
  'zoom' | 'google_meet' | 'whatsapp',
])[] = [
  // Monday
  [0, 9, 0, 30, 'Week kickoff', null, 'google_meet'],
  [0, 9, 30, 60, 'Retainer planning', 'Nuvel Cosmetics', 'zoom'],
  [0, 11, 30, 45, 'Creative review', 'Fern & Field', 'google_meet'],
  [0, 14, 0, 30, 'Creative standup', null, 'google_meet'],
  [0, 15, 0, 60, 'Media plan sign-off', 'Kite Airlines', 'zoom'],
  [0, 16, 30, 30, 'Pipeline check', null, 'whatsapp'],
  // Tuesday
  [1, 8, 30, 45, 'Client check-in', 'Kite Airlines', 'whatsapp'],
  [1, 10, 0, 30, 'Standup', null, 'google_meet'],
  [1, 11, 0, 90, 'Shoot prep', 'Fern & Field', 'google_meet'],
  [1, 14, 0, 60, 'Content calendar', 'Orbit Fitness', 'zoom'],
  [1, 16, 0, 30, 'Pacing review', null, 'google_meet'],
  [1, 17, 0, 45, 'Creative handover', 'Nuvel Cosmetics', 'google_meet'],
  // Wednesday
  [2, 9, 0, 30, 'Standup', null, 'google_meet'],
  [2, 10, 0, 60, 'Quarterly business review', 'Al Barsha Motors', 'zoom'],
  [2, 12, 0, 45, 'Influencer brief', 'Orbit Fitness', 'whatsapp'],
  [2, 14, 0, 30, 'Analytics walkthrough', 'Kite Airlines', 'google_meet'],
  [2, 15, 30, 30, 'Design crit', null, 'google_meet'],
  [2, 17, 0, 60, 'Campaign retro', 'Nuvel Cosmetics', 'zoom'],
  // Thursday
  [3, 9, 0, 30, 'Standup', null, 'whatsapp'],
  [3, 10, 30, 45, 'Creative concepts', 'Fern & Field', 'google_meet'],
  [3, 12, 0, 60, 'Budget approval', 'Orbit Fitness', 'whatsapp'],
  [3, 14, 30, 30, 'Landing page review', 'Al Barsha Motors', 'google_meet'],
  [3, 15, 30, 45, 'Media buying sync', null, 'google_meet'],
  [3, 17, 0, 45, 'Pitch rehearsal', null, 'google_meet'],
  // Friday
  [4, 9, 30, 30, 'Standup', null, 'google_meet'],
  [4, 10, 30, 45, 'Weekly report walkthrough', 'Nuvel Cosmetics', 'google_meet'],
  [4, 12, 0, 30, 'Creative sign-off', 'Fern & Field', 'whatsapp'],
  [4, 14, 0, 45, 'Performance review', 'Al Barsha Motors', 'zoom'],
  [4, 15, 0, 60, 'New business intro', 'Kite Airlines', 'zoom'],
  [4, 16, 30, 30, 'Week wrap', null, 'google_meet'],
  // Sunday — the UAE working week starts here, and an empty column on the
  // calendar's first day reads as a bug rather than as a quiet day.
  [6, 11, 0, 45, 'Weekend performance check', 'Orbit Fitness', 'zoom'],
  [6, 18, 0, 30, 'Launch monitoring', 'Fern & Field', 'whatsapp'],
]

/**
 * Today, placed around the clock rather than around the working day.
 *
 * The rest of the week uses fixed office hours, which is realistic and also
 * useless for looking at the product: open it at 20:00 and every one of
 * today's meetings finished hours ago, so "Up next" and "The rest of your
 * day" are empty and Home looks broken when it is merely accurate.
 *
 * The design source fakes its meetings relative to whenever you load it,
 * which is why the mock always looks busy. This does the same, so every
 * state Home can render — one live with a Join button, some ahead, some
 * behind, a client email pending, a call with no link — is on screen no
 * matter what time the demo is being given.
 *
 * `[minutes from now, duration, title, client, platform]`. Negative is past.
 */
const TODAY: readonly (readonly [
  number,
  number,
  string,
  string | null,
  'zoom' | 'google_meet' | 'whatsapp',
])[] = [
  [-260, 45, 'Morning standup', null, 'google_meet'],
  [-180, 60, 'Creative review', 'Nuvel Cosmetics', 'zoom'],
  [-95, 30, 'Pacing check', null, 'google_meet'],
  // Live right now: starts before this runs, ends after. This is the one
  // that puts the "IN PROGRESS" card and its Join button on screen.
  [-12, 40, 'Campaign kickoff', 'Fern & Field', 'zoom'],
  [25, 30, 'Creative handover', 'Orbit Fitness', 'google_meet'],
  // WhatsApp: no join link by design, which is what "You'll need to call"
  // in Needs You is reporting.
  [95, 60, 'Monthly retainer review', 'Al Barsha Motors', 'whatsapp'],
  [215, 30, 'Paid social sync', null, 'google_meet'],
]

const hash = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)

const letters = (s: string, n: number) =>
  [...Array(n)].map((_, i) => String.fromCharCode(97 + ((hash(s) >> (i * 3)) % 26))).join('')

/** Meet and Zoom need a link or the entry is one nobody can join (§4.2).
 *  Derived from the title so re-running produces the same links. */
function linkFor(provider: string, title: string): string | null {
  if (provider === 'zoom') return `https://zoom.us/j/${88000000000 + (hash(title) % 900000)}`
  if (provider === 'google_meet') {
    return `https://meet.google.com/${letters(title, 3)}-${letters(title + 'x', 4)}-${letters(title + 'y', 3)}`
  }
  return null
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  const db = drizzle(sql)

  try {
    const [owner] = await db
      .select({ id: users.id, orgId: users.orgId, timezone: users.timezone })
      .from(users)
      .orderBy(users.createdAt)
      .limit(1)

    if (!owner) throw new Error('No users. Run npm run db:seed first.')

    if (process.argv[2] === 'clear') {
      const goneMeetings = await db
        .delete(meetings)
        .where(and(eq(meetings.orgId, owner.orgId), like(meetings.description, `${TAG}%`)))
        .returning({ id: meetings.id })

      const goneClients = await db
        .delete(clients)
        .where(and(eq(clients.orgId, owner.orgId), like(clients.notes, `${TAG}%`)))
        .returning({ id: clients.id })

      // Demo people are marked in avatar_url, which nothing else writes.
      const gonePeople = await db
        .delete(users)
        .where(and(eq(users.orgId, owner.orgId), like(users.avatarUrl, `${TAG}%`)))
        .returning({ id: users.id })

      console.log(
        `removed ${goneMeetings.length} meeting(s), ${goneClients.length} client(s), ${gonePeople.length} teammate(s)`,
      )
      return
    }

    /* ── People ──────────────────────────────────────────────────────────
       No password hash by default, so none of them can sign in. They exist
       to be attendees; an account reachable without anyone choosing a
       password would be a hole, not a convenience.

       `-- with-logins` sets a known password on each so the app can be seen
       from more than one side — reading a message as the person it was sent
       to is the only way to check chat actually works. Opt-in, announced
       loudly, and refused outright when NODE_ENV is production, because the
       whole point is that these accounts are otherwise unreachable.        */
    const withLogins = process.argv.includes('with-logins')

    if (withLogins && process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to create demo accounts with passwords in production.')
    }

    const demoHash = withLogins ? await hashPassword(DEMO_PASSWORD) : null

    const roleRows = await db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.orgId, owner.orgId))

    const peopleIds: Record<string, string> = {}
    for (const p of PEOPLE) {
      const email = `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@mediaclicks.example`

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.orgId, owner.orgId), eq(users.email, email)))
        .limit(1)

      if (existing) {
        peopleIds[p.name] = existing.id
        // Re-running with the flag should let people in who were created
        // without it, rather than silently doing nothing.
        if (demoHash) {
          await db.update(users).set({ passwordHash: demoHash }).where(eq(users.id, existing.id))
        }
        continue
      }

      const [made] = await db
        .insert(users)
        .values({
          orgId: owner.orgId,
          email,
          fullName: p.name,
          passwordHash: demoHash,
          avatarUrl: `${TAG} ${p.title}`,
          timezone: owner.timezone,
        })
        .returning({ id: users.id })

      peopleIds[p.name] = made!.id

      const role = roleRows.find((r) => r.name === p.role)
      if (role) {
        await db
          .insert(userRoles)
          .values({ userId: made!.id, roleId: role.id })
          .onConflictDoNothing()
      }
    }

    /* ── Clients ─────────────────────────────────────────────────────── */
    const clientIds: Record<string, string> = {}
    for (const c of CLIENTS) {
      const [existing] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.orgId, owner.orgId), eq(clients.companyName, c.name)))
        .limit(1)

      if (existing) {
        clientIds[c.name] = existing.id
        continue
      }

      const [made] = await db
        .insert(clients)
        .values({
          orgId: owner.orgId,
          companyName: c.name,
          contactName: c.contact,
          email: c.email,
          phoneE164: c.phone,
          region: c.region,
          notes: `${TAG} from the design`,
        })
        .returning({ id: clients.id })

      clientIds[c.name] = made!.id
    }

    /* ── The week ──────────────────────────────────────────────────────
       Last week, this week and next, so Today, the week view and "next
       week" all have something — and so a meeting has somewhere to move
       to when the assistant reschedules one.                            */
    const everyone = Object.values(peopleIds)
    const now = new Date()
    const monday = mondayOf(now, owner.timezone)
    // 0 = Monday, matching WEEK's day index.
    const todayIdx = (new Date(now.toLocaleString('en-US', { timeZone: owner.timezone })).getDay() + 6) % 7

    /**
     * Every meeting to create, as absolute instants.
     *
     * Today comes from TODAY (relative to now); every other day of every
     * week comes from WEEK (fixed office hours). Today's WEEK rows are
     * skipped rather than added alongside, or the day would hold both a
     * plausible schedule and a second one on top of it.
     */
    const planned: {
      startsAt: Date
      endsAt: Date
      title: string
      clientName: string | null
      provider: 'zoom' | 'google_meet' | 'whatsapp'
    }[] = []

    for (const weekOffset of [-1, 0, 1]) {
      for (const [dayIdx, hour, minute, minutes, title, clientName, provider] of WEEK) {
        if (weekOffset === 0 && dayIdx === todayIdx) continue
        const startsAt = addDays(monday, dayIdx + weekOffset * 7)
        startsAt.setHours(hour, minute, 0, 0)
        planned.push({
          startsAt,
          endsAt: new Date(startsAt.getTime() + minutes * 60_000),
          title,
          clientName,
          provider,
        })
      }
    }

    for (const [offset, minutes, title, clientName, provider] of TODAY) {
      const startsAt = new Date(now.getTime() + offset * 60_000)
      startsAt.setSeconds(0, 0)
      planned.push({
        startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * 60_000),
        title,
        clientName,
        provider,
      })
    }

    let made = 0
    for (const { startsAt, endsAt, title, clientName, provider } of planned) {
      const [row] = await db
        .insert(meetings)
        .values({
          orgId: owner.orgId,
          title,
          description: `${TAG} from the design — safe to delete`,
          startsAt,
          endsAt,
          type: clientName ? 'client' : 'internal',
          clientId: clientName ? clientIds[clientName]! : null,
          createdByUserId: owner.id,
          conferencingProvider: provider,
          conferenceUrl: linkFor(provider, title),
          status: 'scheduled',
        })
        .returning({ id: meetings.id })

      // Three or four people, chosen by a stable hash so the same meeting
      // always has the same room rather than a different one per run.
      const room = [owner.id, ...rotate(everyone, hash(title))].slice(0, 3 + (hash(title) % 2))

      await db.insert(meetingAttendees).values(
        room.map((userId) => ({
          meetingId: row!.id,
          userId,
          // Two attendees left unanswered on purpose: Needs You's "no reply"
          // card has nothing to report if everybody has accepted.
          response: userId === owner.id ? ('accepted' as const) : ('pending' as const),
        })),
      )
      made += 1
    }

    console.log(
      `added ${CLIENTS.length} clients, ${PEOPLE.length} teammates and ${made} meetings ` +
        `across three weeks (${TODAY.length} of them today, one live right now)`,
    )

    if (demoHash) {
      console.log('\nthese accounts can now sign in — dev only, never in production:')
      for (const p of PEOPLE) {
        console.log(
          `  ${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@mediaclicks.example`.padEnd(46) +
            DEMO_PASSWORD,
        )
      }
      console.log('\nrun without `with-logins` to leave them unable to sign in.')
    } else {
      console.log(
        '\nteammates cannot sign in. To check chat from both sides:\n' +
          '  npm run db:demo -- with-logins',
      )
    }

    console.log('\nundo with: npm run db:demo -- clear')
  } finally {
    await sql.end()
  }
}

/** Monday of the current week, at local midnight in the owner's zone. */
function mondayOf(now: Date, zone: string): Date {
  const local = new Date(now.toLocaleString('en-US', { timeZone: zone }))
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7))
  local.setHours(0, 0, 0, 0)
  return local
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function rotate<T>(xs: readonly T[], by: number): T[] {
  if (xs.length === 0) return []
  const n = by % xs.length
  return [...xs.slice(n), ...xs.slice(0, n)]
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
