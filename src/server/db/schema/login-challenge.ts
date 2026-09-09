import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Second-factor codes, issued after a correct password and before a session.
 *
 * The same three rules as `password_reset_tokens`, plus one this table needs
 * and that one does not.
 *
 * **The code is stored only as a hash — salted with the row's own id.** A
 * reset token is 32 random bytes, so a bare SHA-256 of it is unguessable. A
 * six-digit code is one of a million, which a laptop enumerates instantly:
 * an unsalted hash column would let anyone holding a database dump read
 * every live code. So the hash covers `${id}:${code}`, and the id is a
 * random uuid generated in application code rather than by the column
 * default — the id has to exist *before* the hash can be computed. That
 * makes the million-guess table per-row rather than global, and a dump of
 * this table worth nothing after the ten minutes are up.
 *
 * **`attempts` is the real defence, not the hash.** Six digits is small
 * enough that an online guesser would get there in hours; the counter kills
 * the challenge at five wrong tries, which is the number that matters.
 *
 * **`remember` rides along.** The device choice is made on the password
 * screen but cannot be applied until the code is accepted, and a browser
 * that could re-assert it at step two would be choosing its own session
 * length. So it is written here, at the point it was genuinely made, and
 * read back from the row rather than from the request.
 *
 * Rows are kept after use, like reset tokens, so "signed in from a code at
 * 14:02" stays answerable. Cleanup is by age.
 */
export const loginChallenges = pgTable(
  'login_challenges',
  {
    /** Generated in application code, not by the database — it salts the hash. */
    id: uuid('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 of `${id}:${code}`, hex. */
    codeHash: text('code_hash').notNull(),

    /** The device choice from the password step. See the note above. */
    remember: boolean('remember').notNull().default(false),

    /** Wrong guesses so far. The challenge dies at MAX_ATTEMPTS. */
    attempts: integer('attempts').notNull().default(0),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Rate limiting counts a user's recent challenges; cleanup sweeps by age.
    index('login_challenge_user_created_idx').on(t.userId, t.createdAt),
  ],
)
