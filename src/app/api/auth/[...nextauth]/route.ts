import { handlers } from '@/server/auth'

// Node runtime, not Edge: the credentials provider needs argon2 (a native
// module) and a TCP connection to Postgres.
export const runtime = 'nodejs'

export const { GET, POST } = handlers
