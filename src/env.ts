import 'server-only'
import { z } from 'zod'

/**
 * Fail at boot with a readable message rather than at the first query with an
 * inscrutable one. Imported for its side effect by the db client.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required — generate with `npx auth secret`'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
  throw new Error(`Invalid environment:\n${lines.join('\n')}`)
}

export const env = parsed.data
