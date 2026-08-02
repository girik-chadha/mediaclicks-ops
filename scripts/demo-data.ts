/**
 * Inserts a few meetings for today so the Today and Calendar screens have
 * something to draw, then removes them again on request.
 *
 *   npm run db:demo          insert
 *   npm run db:demo -- clear remove everything this script created
 *
 * Every row is tagged in its description, so `clear` removes exactly what was
 * added and can never touch a real meeting.
 */
import { config } from 'dotenv'
import { and, eq, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { clients, meetingAttendees, meetings, users } from '../src/server/db/schema'

config({ path: '.env.local' })
config({ path: '.env' })

const TAG = '[demo]'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  const client = postgres(databaseUrl, { max: 1, prepare: false })
  const db = drizzle(client)

  try {
    const [owner] = await db
      .select({ id: users.id, orgId: users.orgId, timezone: users.timezone })
      .from(users)
      .orderBy(users.createdAt)
      .limit(1)

    if (!owner) throw new Error('No users. Run npm run db:seed first.')

    if (process.argv[2] === 'clear') {
      const removed = await db
        .delete(meetings)
        .where(and(eq(meetings.orgId, owner.orgId), like(meetings.description, `${TAG}%`)))
        .returning({ id: meetings.id })
      console.log(`removed ${removed.length} demo meeting(s)`)
      return
    }

    const team = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.orgId, owner.orgId))

    // A client, so one meeting can show the eyebrow and the email path.
    const existingClient = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.orgId, owner.orgId), eq(clients.companyName, 'Nuvel Cosmetics')))
      .limit(1)

    const clientId =
      existingClient[0]?.id ??
      (
        await db
          .insert(clients)
          .values({
            orgId: owner.orgId,
            companyName: 'Nuvel Cosmetics',
            contactName: 'Dina Haddad',
            email: 'dina@nuvel.example',
            phoneE164: '+971 50 118 2240',
            region: 'domestic',
            notes: `${TAG} demo client`,
          })
          .returning({ id: clients.id })
      )[0]!.id

    const now = new Date()
    const at = (minutesFromNow: number, lengthMinutes: number) => ({
      startsAt: new Date(now.getTime() + minutesFromNow * 60_000),
      endsAt: new Date(now.getTime() + (minutesFromNow + lengthMinutes) * 60_000),
    })

    const rows = [
      {
        title: 'Creative standup',
        ...at(-150, 30),
        type: 'internal' as const,
        clientId: null,
        provider: 'google_meet' as const,
        url: 'https://meet.google.com/xkq-djmb-ptz',
      },
      {
        // Inside the 30-minute window, so the countdown and time go magenta.
        title: 'Retainer planning',
        ...at(18, 60),
        type: 'client' as const,
        clientId,
        provider: 'zoom' as const,
        url: 'https://zoom.us/j/88412207553',
      },
      {
        // No link, so the block draws with a dashed rule and reads "No link".
        title: 'Pacing review',
        ...at(180, 45),
        type: 'internal' as const,
        clientId: null,
        provider: 'whatsapp' as const,
        url: null,
      },
    ]

    for (const row of rows) {
      const [created] = await db
        .insert(meetings)
        .values({
          orgId: owner.orgId,
          title: row.title,
          description: `${TAG} sample meeting — safe to delete`,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          type: row.type,
          clientId: row.clientId,
          createdByUserId: owner.id,
          conferencingProvider: row.provider,
          conferenceUrl: row.url,
          status: 'scheduled',
        })
        .returning({ id: meetings.id })

      await db.insert(meetingAttendees).values(
        team.map((member) => ({
          meetingId: created!.id,
          userId: member.id,
          response: member.id === owner.id ? ('accepted' as const) : ('pending' as const),
        })),
      )
    }

    console.log(`inserted ${rows.length} demo meetings for today`)
    console.log('remove them with: npm run db:demo -- clear')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
