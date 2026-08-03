'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { updateProfileAction, type ProfileState } from './actions'

const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'
const LABEL = 'mb-1 block text-label font-medium text-slate'
const HELP = 'mt-1 block text-label text-slate'

/** A short list beats 400 IANA zones nobody in this agency will use. */
const ZONES = [
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
]

const LEADS = [15, 30, 60]

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 cursor-pointer rounded-sm btn-signal px-4 text-body font-semibold disabled:opacity-60"
    >
      {pending ? 'Saving' : 'Save changes'}
    </button>
  )
}

export function ProfileForm({
  fullName,
  email,
  phoneE164,
  timezone,
  roleLabel,
  dailyDigest,
  digestTime,
  reminderLeadMinutes,
  initials,
}: {
  fullName: string
  email: string
  phoneE164: string | null
  timezone: string
  roleLabel: string
  dailyDigest: boolean
  digestTime: string
  reminderLeadMinutes: number
  initials: string
}) {
  const [state, formAction] = useActionState<ProfileState, FormData>(
    updateProfileAction,
    {},
  )

  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]

  return (
    <form
      action={formAction}
      className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start"
    >
      {/* Profile */}
      <section className="min-w-0 flex-1 rounded-sm border border-rule bg-surface p-6">
        <div className="text-micro uppercase text-slate">Profile</div>

        <div className="mt-4 flex items-center gap-4">
          <span className="flex size-[72px] shrink-0 items-center justify-center rounded-full border border-rule bg-paper text-data-lg font-semibold text-slate">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="text-body leading-[1.4]">{fullName}</div>
            <div className="truncate text-label text-slate">{email}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Full name</span>
            <input name="fullName" defaultValue={fullName} required className={CONTROL} />
            <span className={HELP}>Shown to everyone in the organisation.</span>
          </label>

          <label className="block">
            <span className={LABEL}>Work email</span>
            <input
              value={email}
              readOnly
              className={`${CONTROL} text-slate`}
              aria-describedby="email-help"
            />
            <span id="email-help" className={HELP}>
              Your sign-in. Only an owner can change it.
            </span>
          </label>

          <label className="block">
            <span className={LABEL}>Phone</span>
            <input
              name="phoneE164"
              defaultValue={phoneE164 ?? ''}
              placeholder="+971 50 000 0000"
              className={`${CONTROL} font-mono tabular-nums`}
            />
            <span className={HELP}>Used on WhatsApp meetings.</span>
          </label>

          <label className="block">
            <span className={LABEL}>Role</span>
            <input value={roleLabel} readOnly className={`${CONTROL} text-slate`} />
            <span className={HELP}>Set by an owner on the team screen.</span>
          </label>

          <label className="block sm:col-span-2">
            <span className={LABEL}>Timezone</span>
            <select name="timezone" defaultValue={timezone} className={CONTROL}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace('_', ' ')}
                </option>
              ))}
            </select>
            <span className={HELP}>
              Everything is stored in UTC and shown in this zone. Changing it re-renders
              your calendar; it does not move any meeting.
            </span>
          </label>
        </div>
      </section>

      {/* Notifications */}
      <section className="w-full shrink-0 rounded-sm border border-rule bg-surface p-6 lg:w-[400px]">
        <div className="text-micro uppercase text-slate">Notifications</div>

        <div className="mt-4 flex items-center justify-between gap-4 border-b border-rule pb-4">
          <div className="min-w-0">
            <div className="text-body leading-[1.4]">Daily digest</div>
            <div className="text-label text-slate">
              One email with the day&rsquo;s run of show.
            </div>
          </div>
          {/* A real checkbox styled as the design's switch: it is focusable,
              it is announced correctly, and it submits with the form. */}
          <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              name="dailyDigest"
              defaultChecked={dailyDigest}
              className="peer size-full cursor-pointer appearance-none rounded-sm border border-rule transition-colors duration-[80ms] checked:border-signal checked:bg-fill-signal focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2"
            />
            <span className="pointer-events-none absolute left-0.5 top-0.5 size-[18px] rounded-sm border border-rule bg-surface transition-[left] duration-[80ms] peer-checked:left-[22px]" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-rule py-4">
          <div className="text-body">Digest time</div>
          <input
            type="time"
            name="digestTime"
            defaultValue={digestTime}
            className="h-8 rounded-sm border border-rule bg-surface px-2 font-mono text-label tracking-[-0.02em] tabular-nums"
          />
        </div>

        <fieldset className="border-b border-rule py-4">
          <legend className="text-body">Reminder lead time</legend>
          <div className="mt-2 flex gap-2">
            {LEADS.map((minutes) => (
              <label key={minutes} className="cursor-pointer">
                <input
                  type="radio"
                  name="reminderLeadMinutes"
                  value={minutes}
                  defaultChecked={minutes === reminderLeadMinutes}
                  className="peer sr-only"
                />
                <span className="flex h-8 items-center rounded-sm border border-rule px-3 font-mono text-label tracking-[-0.02em] text-slate transition-colors duration-[80ms] peer-checked:border-signal peer-checked:bg-fill-signal peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-signal">
                  {minutes}m
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="mt-4 text-label text-slate">
          Saved now, sent from Phase 3. Nothing is delivered yet.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Submit />
          {state.error && (
            <span role="alert" className="text-label text-slate">
              {state.error}
            </span>
          )}
          {state.saved && (
            <span role="status" className="text-label text-slate">
              Changes saved
            </span>
          )}
        </div>
      </section>
    </form>
  )
}
