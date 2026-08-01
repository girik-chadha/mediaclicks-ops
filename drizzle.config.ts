import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// .env.local wins, matching Next's own precedence.
config({ path: '.env.local' })
config({ path: '.env' })

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // `generate` works offline from the schema; only `migrate` and `studio`
    // need this to be reachable.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/placeholder',
  },
  strict: true,
  verbose: true,
})
