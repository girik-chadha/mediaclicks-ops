'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { updateProfileAction, type ProfileState } from './actions'

const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'

/** A short list beats 400 IANA zones in a select the agency will never use. */
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

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 cursor-pointer rounded-sm bg-signal px-4 text-body font-semibold text-white transition-colors duration-[80ms] hover:bg-ink disabled:opacity-60"
    >
      {pending ? 'Saving' : 'Save changes'}
    </button>
  )
}

export function ProfileForm({
  fullName,
  phoneE164,
  timezone,
}: {
  fullName: string
  phoneE164: string | null
  timezone: string
}) {
  const [state, formAction] = useActionState<ProfileState, FormData>(
    updateProfileAction,
    {},
  )

  // The stored zone may not be in the short list; keep it selectable.
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="block">
        <span className="mb-1 block text-label text-slate">Full name</span>
        <input name="fullName" defaultValue={fullName} required className={CONTROL} />
        <span className="mt-1 block text-label text-slate">
          Shown to everyone in the organisation.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-label text-slate">Phone</span>
        <input
          name="phoneE164"
          defaultValue={phoneE164 ?? ''}
          placeholder="+971 50 000 0000"
          className={`${CONTROL} font-mono tabular-nums`}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-label text-slate">Timezone</span>
        <select name="timezone" defaultValue={timezone} className={CONTROL}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace('_', ' ')}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-label text-slate">
          Every time in the app is stored in UTC and shown in this zone. Changing it
          re-renders your whole calendar; it does not move any meeting.
        </span>
      </label>

      <div className="flex items-center gap-3">
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
    </form>
  )
}
