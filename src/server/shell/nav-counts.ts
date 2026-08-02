import 'server-only'
import { sql } from 'drizzle-orm'
import type { SessionActor } from '../auth/session'
import { db } from '../db'

export interface NavCounts {
  today: number
  clients: number
  team: number
  unread: number
}

/**
 * Every number the nav renders, in one round trip.
 *
 * The layout previously called listMeetingsInRange, listTeam, listClients and
 * the chat queries — roughly six round trips — to render four small numbers
 * and pre-fill a command palette most page views never open. At ~160ms per
 * round trip that was most of a second on every navigation.
 *
 * Scalar subqueries in a single statement: Postgres plans them together and
 * the wire carries one request instead of six.
 *
 * The today count is deliberately org-wide rather than can()-filtered. Doing
 * it properly would mean fetching every row and its attendees to run the
 * permission check — which is the cost this exists to avoid — and every
 * seeded role holds meeting.view.all, so the two agree in practice. The
 * screens themselves still filter through can(); this is a badge.
 */
export async function navCounts(actor: SessionActor): Promise<NavCounts> {
  const [row] = await db.execute<{
    today: number
    clients: number
    team: number
    unread: number
  }>(sql`
    select
      (select count(*)::int from meetings m
        where m.org_id = ${actor.orgId}
          and m.status <> 'cancelled'
          and m.starts_at < now() + interval '1 day'
          and m.ends_at   > now() - interval '1 day') as today,
      (select count(*)::int from clients c
        where c.org_id = ${actor.orgId}) as clients,
      (select count(*)::int from users u
        where u.org_id = ${actor.orgId} and u.deactivated_at is null) as team,
      (select count(*)::int from messages msg
        join channel_members cm
          on cm.channel_id = msg.channel_id and cm.user_id = ${actor.id}
        join channels ch on ch.id = msg.channel_id
        where ch.org_id = ${actor.orgId}
          and ch.archived_at is null
          and msg.deleted_at is null
          and msg.author_user_id is distinct from ${actor.id}
          and (cm.last_read_at is null or msg.created_at > cm.last_read_at)) as unread
  `)

  return {
    today: Number(row?.today ?? 0),
    clients: Number(row?.clients ?? 0),
    team: Number(row?.team ?? 0),
    unread: Number(row?.unread ?? 0),
  }
}
