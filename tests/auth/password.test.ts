import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/server/auth/password'

describe('password hashing', () => {
  it('produces an Argon2id hash, not Argon2d or Argon2i', async () => {
    // Guards the pinned numeric literal in password.ts. @node-rs/argon2
    // exports Algorithm as an ambient const enum that verbatimModuleSyntax
    // cannot read as a value, so the constant is inlined — this asserts
    // against the real output rather than trusting the number.
    const encoded = await hashPassword('correct horse battery staple')
    expect(encoded.startsWith('$argon2id$')).toBe(true)
  })

  it('encodes the OWASP parameters into the hash', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    expect(encoded).toContain('m=19456')
    expect(encoded).toContain('t=2')
    expect(encoded).toContain('p=1')
  })

  it('salts, so the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same input'),
      hashPassword('same input'),
    ])
    expect(a).not.toBe(b)
  })

  it('verifies a correct password', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(encoded, 'correct horse battery staple')).resolves.toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(encoded, 'Correct horse battery staple')).resolves.toBe(false)
  })

  it('returns false for a null hash rather than throwing', async () => {
    // An OAuth-only account (Phase 4) has no password_hash.
    await expect(verifyPassword(null, 'anything')).resolves.toBe(false)
  })

  it('returns false for a malformed hash rather than throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false)
  })
})
