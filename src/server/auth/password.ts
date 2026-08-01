import { hash, verify, type Algorithm } from '@node-rs/argon2'

/**
 * Argon2id at OWASP's recommended floor: 19 MiB memory, 2 iterations, 1 lane.
 * Memory cost is what makes GPU cracking expensive, so it is the parameter
 * worth spending on. Note the library's own defaults are weaker (4 MiB, t=3),
 * which is why every parameter is set explicitly.
 *
 * `Algorithm` is exported as an ambient `const enum`, which cannot be read as
 * a value under `verbatimModuleSyntax`. Importing it as a type and pinning
 * the numeric literal keeps both. The literal is guarded by a test asserting
 * the encoded hash is actually `$argon2id$` — so if the value ever drifted,
 * the suite fails rather than silently downgrading to Argon2d.
 */
const ARGON2ID = 2 as Algorithm

const PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Native module, so anything importing this is pinned to the Node runtime and
 * must stay out of the Edge middleware bundle — hence the auth.config.ts /
 * auth.ts split.
 *
 * Deliberately no `import 'server-only'`: the seed script needs this, and
 * that marker would break it. Nothing leaks by its absence — a native module
 * cannot be bundled for the browser, and there are no secrets in this file.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS)
}

/**
 * Returns false rather than throwing on a missing or malformed hash. A user
 * row with a null `password_hash` is an OAuth-only account (Phase 4), and a
 * corrupt one is a failed sign-in — neither is a 500.
 */
export async function verifyPassword(
  storedHash: string | null,
  plain: string,
): Promise<boolean> {
  if (!storedHash) return false
  try {
    return await verify(storedHash, plain)
  } catch {
    return false
  }
}
