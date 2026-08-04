/**
 * Finding the people and the client named in a phrase.
 *
 * Pure, so every case below is a test rather than something discovered in
 * production — which matters here because the failure mode is silent: a
 * wrong match produces a confident card naming the wrong person.
 *
 * The approach is to scan for names that actually exist rather than to
 * split the phrase into parts and hope each part is a name. Real input
 * defeats every separator rule:
 *
 *   "emma girik lina and the client is al barsha motors"
 *
 * Splitting on "and" makes "emma girik lina" one person. Splitting on
 * spaces makes "Al Barsha Motors" three clients. Matching known names,
 * longest first, gets all five right and quietly ignores "and the client
 * is" without needing a rule for it.
 */

export interface Person {
  readonly id: string
  readonly fullName: string
}

export interface Client {
  readonly id: string
  readonly companyName: string
}

export interface Matched {
  readonly clients: Client[]
  readonly people: Person[]
  /** Set when one term could mean two different people — never guessed. */
  readonly ambiguous: { term: string; options: string[] } | null
}

interface Candidate {
  readonly term: string
  readonly kind: 'client' | 'person'
  readonly id: string
  readonly label: string
}

export function matchParties(
  phrase: string,
  clients: readonly Client[],
  team: readonly Person[],
): Matched {
  const candidates: Candidate[] = [
    ...clients.map((c) => ({
      term: c.companyName.toLowerCase(),
      kind: 'client' as const,
      id: c.id,
      label: c.companyName,
    })),
    ...team.map((p) => ({
      term: p.fullName.toLowerCase(),
      kind: 'person' as const,
      id: p.id,
      label: p.fullName,
    })),
    // First names too, because that is what people type. Listed after full
    // names so an exact full-name hit is consumed first.
    ...team.map((p) => ({
      term: (p.fullName.toLowerCase().split(/\s+/)[0] ?? '').trim(),
      kind: 'person' as const,
      id: p.id,
      label: p.fullName,
    })),
  ].filter((c) => c.term.length >= 2)

  // Longest first, so "al barsha motors" is taken before a teammate called
  // "Al" could claim its first word.
  candidates.sort((a, b) => b.term.length - a.term.length)

  const foundClients = new Map<string, Client>()
  const foundPeople = new Map<string, Person>()

  // Punctuation becomes space, so "emma, lina and omar" does not hide Emma
  // behind a comma. Padded at both ends so matching can require whole words
  // without building a regex per name.
  let rest = ` ${phrase.toLowerCase().replace(/[.,;:!?()]/g, ' ').replace(/\s+/g, ' ').trim()} `

  for (const c of candidates) {
    const needle = ` ${c.term} `
    if (!rest.includes(needle)) continue

    // A term that names two different people is not a match, it is a
    // question. Two teammates called Girik means "girik" cannot be resolved
    // by the computer, and guessing puts the wrong person in a meeting.
    const rivals = candidates.filter((o) => o.term === c.term && o.id !== c.id)
    if (rivals.length > 0) {
      return {
        clients: [],
        people: [],
        ambiguous: {
          term: c.term,
          options: [c.label, ...rivals.map((r) => r.label)],
        },
      }
    }

    rest = rest.replace(needle, ' ')
    if (c.kind === 'client') foundClients.set(c.id, { id: c.id, companyName: c.label })
    else foundPeople.set(c.id, { id: c.id, fullName: c.label })
  }

  return {
    clients: [...foundClients.values()],
    people: [...foundPeople.values()],
    ambiguous: null,
  }
}
