import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Password reset tokens.
 *
 * Three properties matter more than the table:
 *
 * **The token is not stored.** Only a SHA-256 of it. A reset token is a
 * bearer credential — whoever holds it can take over the account — so a
 * readable copy in the database would mean anyone with a database dump could
 * seize every account without knowing a single password. Hashing means the
 * value in the email is the only copy that exists.
 *
 * SHA-256 rather than argon2, which hashes the passwords themselves: argon2
 * is deliberately slow to make guessing a human-chosen password expensive.
 * These are 32 random bytes, so guessing is not a threat and slowness would
 * only be a denial-of-service surface on an unauthenticated endpoint.
 *
 * **Single use.** `used_at` is set the moment a token is spent, so a link
 * left in an inbox — or forwarded, or in a mail server's logs — stops
 * working after the first use.
 *
 * **Short-lived.** `expires_at` bounds how long a leaked email is dangerous.
 *
 * Rows are kept after use rather than deleted, so "this account was reset on
 * Tuesday" stays answerable. Cleanup is by age, not by state.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * CASCADE, unlike audit's SET NULL. A token is only meaningful as a way
     * into one account; once that account is gone the row is not history
     * worth keeping, it is a dangling capability.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 of the token, hex. Unique so a collision cannot be ambiguous. */
    tokenHash: text('token_hash').notNull().unique(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Rate limiting counts a user's recent requests; cleanup sweeps by age.
    index('password_reset_user_created_idx').on(t.userId, t.createdAt),
  ],
)
