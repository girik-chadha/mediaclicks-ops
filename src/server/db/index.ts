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

const client =
  globalForDb.__mediaclicksSql ?? postgres(env.DATABASE_URL, { max: 10 })

if (env.NODE_ENV !== 'production') {
  globalForDb.__mediaclicksSql = client
}

export const db = drizzle(client, { schema })

export type Db = typeof db
