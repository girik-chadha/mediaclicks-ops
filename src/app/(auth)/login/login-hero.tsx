'use client'

import { LogoMark } from '@/components/shell/logo'
import { formatClock, timezoneLabel, useNow } from '@/components/shell/use-now'
import { useZone } from '@/components/shell/zone-context'

/**
 * The dark half of the login screen.
 *
 * Dark in both themes — it is a fixed surface, not a themed one — which is
 * why it reads `--d-slate` and `--d-rule` rather than `--slate` and `--rule`.
 *
 * ## The one deliberate departure from the design
 *
 * The design binds this bottom list to `{{ preview }}`, showing client names
 * and meeting titles. Wired to the real table, that publishes the agency's
 * client roster and today's schedule at a public, unauthenticated URL — a
 * competitor could learn who MediaClicks works with and when they meet by
 * loading the login page. The mockup could not have known that; it had no
 * database behind it.
 *
 * So the shape is kept and the content is not real. These rows are fixed,
 * generic, and name nobody. What stays true is the part the brief actually
 * asked this panel for — that the product looks alive before you are let in —
 * because the clock and the Rail's playhead beside it are genuinely live, in
 * the viewer's own zone.
 */

/** Minutes from now, duration, label, platform. Deliberately anonymous. */
const PREVIEW = [
  { at: -20, mins: 45, label: 'Campaign review', code: 'MEET', live: true },
  { at: 35, mins: 30, label: 'Weekly planning', code: 'ZOOM', live: false },
  { at: 120, mins: 60, label: 'Creative handover', code: 'MEET', live: false },
] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function range(now: Date, offsetMinutes: number, duration: number, zone: string | null) {
  const start = new Date(now.getTime() + offsetMinutes * 60_000)
  const end = new Date(start.getTime() + duration * 60_000)
  const read = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      ...(zone ? { timeZone: zone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
    return `${pad(Number(h))}:${m}`
  }
  return `${read(start)}–${read(end)}`
}

export function LoginHero() {
  const now = useNow()
  const zone = useZone()

  return (
    <div className="relative hidden min-w-0 flex-[1.15] flex-col overflow-hidden bg-ink px-14 py-12 text-white lg:flex">
      {/* The timeline bleeding in from the right edge. Decoration, and the
          only decoration on the screen — it is the product's own vocabulary
          (a bar per meeting, --live for the urgent one) rather than an
          illustration of something the app does not do. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[200px] opacity-40">
        <div className="absolute left-10 -right-[60px] top-[22%] h-11 rounded-[2px] border-l-[3px] border-[#2AA5B5] bg-[rgb(42_165_181/0.16)]" />
        <div className="absolute left-[90px] -right-[100px] top-[36%] h-[60px] rounded-[2px] border-l-[3px] border-live bg-[rgb(214_33_107/0.18)]" />
        <div className="absolute left-5 -right-10 top-[52%] h-[38px] rounded-[2px] border-l-[3px] border-dashed border-d-slate" />
      </div>

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* currentColor, so the one mask asset renders white here and ink
              on the panel opposite — no second logo file to drift. */}
          <LogoMark size={52} className="-my-3 -ml-3 -mr-1.5 text-white" />
          <div className="font-display text-title tracking-[-0.02em]">MediaClicks</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[0.8125rem] font-medium tabular-nums tracking-[-0.04em] text-live">
            {now ? formatClock(now, zone) : ' '}
          </div>
          <div className="mt-0.5 text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-d-slate">
            {now ? `${timezoneLabel(now, zone)} · ${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ' '}
          </div>
        </div>
      </div>

      {/* Larger than the mockup's 3rem, and on a narrower measure, so it fills
          the panel instead of sitting in the middle of it. Fluid rather than
          fixed: at 3rem it looked lost on a wide screen, and a single big
          fixed size would overflow a small one. */}
      <div className="relative my-auto py-10">
        <div className="text-micro uppercase text-d-slate">Operations desk</div>
        {/*
          The measure belongs on the text, not the block. `ch` resolves
          against the element's *own* font-size, so a max-width set on the
          wrapper is computed at the inherited 15px — about 136px — and the
          headline shatters into five words down the left edge no matter how
          large its own font-size is. On the h2 it means what it reads as.

          Larger than the mockup's 3rem and on a wider measure, so it fills
          the panel rather than sitting in a column in the middle of it.
          Fluid, because one fixed size that looks right at 1440 is either
          lost at 1920 or clipped at 1280.
        */}
        <h2 className="mt-4 max-w-[20ch] font-display text-[clamp(2.75rem,4.6vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-balance">
          Your day, already in motion.
        </h2>
        <p className="mt-5 max-w-[44ch] text-[1.0625rem] leading-[1.5] text-d-slate text-pretty">
          Every meeting, link, and client — for the whole team, on one timeline.
        </p>
      </div>

      <div className="relative border-t border-d-rule pt-5">
        <div className="flex items-center gap-2 pb-3">
          <div className="size-1 rounded-full bg-live" />
          <div className="font-mono text-micro font-normal tabular-nums tracking-[-0.02em] text-live">
            {now ? formatClock(now, zone) : ' '}
          </div>
          <div className="text-micro uppercase text-d-slate">Live right now</div>
        </div>

        {PREVIEW.map((row) => (
          <div
            key={row.label}
            className="flex items-center gap-4 border-t border-d-rule py-2.5 pl-3"
            style={{ borderLeft: row.live ? '2px solid var(--live)' : '2px solid transparent' }}
          >
            <div
              className={`w-[108px] flex-none font-mono text-[0.8125rem] tabular-nums tracking-[-0.02em] ${
                row.live ? 'text-live' : 'text-d-slate'
              }`}
            >
              {now ? range(now, row.at, row.mins, zone) : ' '}
            </div>
            <div className="min-w-0 flex-1">
              <div className="h-[15px] truncate text-micro uppercase leading-[15px] text-d-slate">
                {row.live ? 'In progress' : 'Scheduled'}
              </div>
              <div className="truncate text-body leading-[1.4]">{row.label}</div>
            </div>
            <div className="font-mono text-micro font-normal tracking-[-0.02em] text-d-slate">
              {row.code}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
