import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from './schema'

/**
 * One connection pool per process. Next's dev server re-evaluates modules on
 * every hot reload, so without stashing the client on globalThis each edit
 * would open a new pool and march steadily toward the connection limit.
 */
const globalForDb = globalThis as unknown as {
  __mediaclicksSql?: ReturnType<typeof postgres>
}

/**
 * Supabase exposes two poolers: transaction mode on 6543 and session mode
 * (or a direct connection) on 5432. Transaction mode recycles the underlying
 * connection between statements, which breaks named prepared statements —
 * they are bound to the connection that created them, so the next statement
 * lands somewhere that has never heard of them.
 *
 * Detected from the port rather than switched on unconditionally, so a direct
 * connection or Neon keeps prepared statements and their query-plan reuse.
 */
function connectionOptions(url: string) {
  let port = ''
  try {
    port = new URL(url).port
  } catch {
    // A malformed URL is env.ts's problem; assume the safe setting.
  }
  const transactionPooler = port === '6543'

  return {
    /**
     * Each serverless instance owns its own pool, so this multiplies by the
     * number of live instances rather than capping total connections. The
     * pooler provides the concurrency; this only needs to cover the parallel
     * queries within a single request.
     */
    max: env.NODE_ENV === 'production' ? 3 : 10,
    prepare: !transactionPooler,
  }
}

const client =
  globalForDb.__mediaclicksSql ??
  postgres(env.DATABASE_URL, connectionOptions(env.DATABASE_URL))

if (env.NODE_ENV !== 'production') {
  globalForDb.__mediaclicksSql = client
}

export const db = drizzle(client, { schema })

export type Db = typeof db
