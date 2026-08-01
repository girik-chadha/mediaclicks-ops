import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * src/lib/permissions must not depend on sessions, Auth.js, the database, or
 * the server runtime.
 *
 * This is an architectural constraint, not a preference, so it is asserted
 * rather than remembered. The pull is toward putting can() next to session
 * handling, because that is where it gets called from — and the moment it
 * imports Auth.js, two things are lost: the matrix needs session mocking to
 * test, and §4.6's assistant tools drag middleware along to call it. The
 * second is what makes "the agent cannot exceed the user" structural rather
 * than a thing someone remembered.
 */

const DIR = 'src/lib/permissions'

const FORBIDDEN = [
  'next-auth',
  'server-only',
  '@/server',
  '../server',
  '../../server',
  'drizzle-orm',
  'postgres',
  '@/env',
  'next/',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f))
}

describe('permission module boundary', () => {
  const files = sourceFiles(DIR)

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} imports nothing session-, server- or database-related`, () => {
      const source = readFileSync(file, 'utf8')
      const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      const violations = specifiers.filter((s) =>
        FORBIDDEN.some((f) => s === f || s.startsWith(f)),
      )
      expect(violations).toEqual([])
    })
  }

  it('imports only from within itself', () => {
    // Anything else would be a route back to the server graph.
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      for (const s of specifiers) {
        expect(s.startsWith('./'), `${file} imports ${s}`).toBe(true)
      }
    }
  })
})
