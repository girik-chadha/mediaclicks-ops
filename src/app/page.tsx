import { ThemeToggle } from '@/components/theme-toggle'

/* TEMPORARY — token specimen.
   Exists to verify that the values extracted from the Claude Design project
   render correctly in both themes. Replaced by the app shell once the session
   shape lands at Stop 3. Not a screen in the product. */

const COLOURS = [
  ['ink', 'Primary text, dark surfaces, structural lines'],
  ['slate', 'Secondary text, labels, inactive states'],
  ['paper', 'App background'],
  ['surface', 'Cards, rails, floating layers'],
  ['rule', 'Hairlines, grid lines, borders'],
  ['signal', 'All interactive elements'],
  ['live', 'Time-criticality only — never decoration'],
] as const

const TYPE = [
  ['text-display-lg font-display', 'display-lg', 'Nothing scheduled'],
  ['text-display-sm font-display', 'display-sm', 'Retainer planning'],
  ['text-title', 'title', 'Meeting detail'],
  ['text-body', 'body', 'The quick brown fox jumps over the lazy dog.'],
  ['text-label', 'label', 'Work email'],
  ['text-micro uppercase', 'micro', 'Nuvel Cosmetics'],
  ['text-data font-mono tabular-nums', 'data', '09:30–10:30'],
  ['text-data-lg font-mono tabular-nums', 'data-lg', '14:07'],
] as const

export default function TokenSpecimen() {
  return (
    <main className="mx-auto max-w-[1440px] px-8 py-12">
      <header className="flex items-start justify-between gap-8">
        <div>
          <h1 className="font-display text-display-lg">MediaClicks</h1>
          <p className="mt-2 text-micro uppercase text-slate">
            Token specimen · not a product screen
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="mt-12">
        <h2 className="text-micro uppercase text-slate">Colour</h2>
        <div className="mt-4 grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {COLOURS.map(([name, use]) => (
            <div key={name} className="bg-surface p-4">
              <div
                className="h-12 w-full border border-rule"
                style={{ background: `var(--${name})` }}
              />
              <div className="mt-3 font-mono text-data">--{name}</div>
              <div className="mt-1 text-label text-slate">{use}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-prose text-label text-slate">
          Magenta appears in exactly four states: the playhead, a meeting in
          progress, a meeting starting within 30 minutes, and an overdue one.
          Anywhere else is a bug.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-micro uppercase text-slate">Type</h2>
        <div className="mt-4 divide-y divide-rule border-y border-rule">
          {TYPE.map(([cls, name, sample]) => (
            <div
              key={name}
              className="flex items-baseline gap-8 py-4"
            >
              <span className="w-24 shrink-0 font-mono text-data text-slate">
                {name}
              </span>
              <span className={cls}>{sample}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 mb-16">
        <h2 className="text-micro uppercase text-slate">Geometry</h2>
        <div className="mt-4 flex flex-wrap gap-6">
          <div className="rounded-lg border border-rule bg-surface p-6">
            <div className="text-label">rounded-lg → 2px</div>
            <div className="mt-1 text-label text-slate">
              Whole scale collapsed
            </div>
          </div>
          <div className="rounded-lg border border-rule bg-surface p-6 shadow-float">
            <div className="text-label">shadow-float</div>
            <div className="mt-1 text-label text-slate">
              The only shadow in the app
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-rule bg-surface p-6">
            <div className="flex size-7 items-center justify-center rounded-full bg-invert text-micro text-invert-fg">
              GC
            </div>
            <div className="text-label text-slate">
              rounded-full — the one exception
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
