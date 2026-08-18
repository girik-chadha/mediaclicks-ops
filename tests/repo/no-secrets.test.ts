import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * No real credential may live in a tracked file.
 *
 * `.env.example` is a list of variable *names*, and it is committed. A real
 * key pasted into it is one `git add -A` from being permanent — and once a
 * secret is in git history, deleting the line does not remove it. This has
 * happened twice, with a Groq key and a Resend key, both caught by eye.
 * Eyes are not a control.
 *
 * The patterns below are provider key prefixes, which are deliberately
 * distinctive so they can be recognised. That is exactly what makes them
 * cheap to detect.
 */
const SECRET_SHAPES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Groq', pattern: /\bgsk_[A-Za-z0-9]{20,}/ },
  { name: 'Resend', pattern: /\bre_[A-Za-z0-9_]{20,}/ },
  { name: 'Anthropic', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
  { name: 'OpenAI', pattern: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'Supabase service key', pattern: /\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  // A connection string whose password is not obviously a placeholder.
  // `postgres:postgres@localhost` and `<password>` are documentation; a
  // 13-character string of noise is not.
  {
    name: 'Postgres URL with password',
    pattern:
      /postgres(?:ql)?:\/\/[^\s:]+:(?!postgres@|password|<|\$|your|xxx|change)[^\s@]{8,}@/i,
  },
]

/** Tracked files that legitimately mention variable names. */
const TRACKED_TEXT = ['.env.example', 'README.md', 'CLAUDE.md']

function scan(label: string, contents: string) {
  for (const { name, pattern } of SECRET_SHAPES) {
    const hit = pattern.exec(contents)
    expect(
      hit,
      `${label} contains what looks like a live ${name} credential ` +
        `(${hit?.[0].slice(0, 12)}…). Move it to .env.local — that file is ` +
        `gitignored. Then rotate the key, because it has been on disk in a ` +
        `tracked file.`,
    ).toBeNull()
  }
}

describe('no credentials in tracked files', () => {
  for (const file of TRACKED_TEXT) {
    it(`${file} holds names, not values`, () => {
      let contents: string
      try {
        contents = readFileSync(file, 'utf8')
      } catch {
        return // not every repo checkout has every file
      }
      scan(file, contents)
    })
  }

  it('no runbook or doc pastes a credential', () => {
    for (const f of readdirSync('docs').filter((f) => f.endsWith('.md'))) {
      scan(`docs/${f}`, readFileSync(`docs/${f}`, 'utf8'))
    }
  })

  it('no script hardcodes one', () => {
    for (const f of readdirSync('scripts')) {
      scan(`scripts/${f}`, readFileSync(`scripts/${f}`, 'utf8'))
    }
  })
})
