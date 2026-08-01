'use client'

import { useState, useTransition } from 'react'
import type { PermissionKey } from '@/lib/permissions'

export interface MatrixPerson {
  id: string
  fullName: string
  email: string
  roleName: string
  permissions: PermissionKey[]
  deactivated: boolean
  /** True when demoting this person would leave the org with no owner (§3). */
  roleLocked: boolean
}

/**
 * The columns. Real permission keys, not the design's illustrative labels —
 * "Billing" does not exist in this product, and a control that toggles
 * nothing is worse than no control.
 */
const COLUMNS: { label: string; key: PermissionKey }[] = [
  { label: 'Create', key: 'meeting.create.any' },
  { label: "Edit others'", key: 'meeting.edit.any' },
  { label: 'All meetings', key: 'meeting.view.all' },
  { label: 'Transcripts', key: 'transcript.view.all' },
  { label: 'Clients', key: 'client.manage' },
  { label: 'Invite', key: 'user.invite' },
  { label: 'Roles', key: 'role.manage' },
]

const PRESETS = ['Owner', 'Manager', 'Member'] as const

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export function PermissionMatrix({
  people,
  canManageRoles,
  onSetRole,
}: {
  people: MatrixPerson[]
  canManageRoles: boolean
  onSetRole: (userId: string, roleName: string) => Promise<{ error?: string }>
}) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function changeRole(userId: string, roleName: string) {
    setError(null)
    startTransition(async () => {
      const result = await onSetRole(userId, roleName)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="min-w-[760px] max-w-[1440px] p-6">
      <div className="flex items-center gap-2">
        <span className="mr-2 text-micro uppercase text-slate">Role preset</span>
        {PRESETS.map((preset) => {
          const active = highlight === preset
          return (
            <button
              key={preset}
              type="button"
              onClick={() => setHighlight(active ? null : preset)}
              aria-pressed={active}
              className="h-7 cursor-pointer rounded-sm px-2.5 text-label font-medium transition-colors duration-[80ms]"
              style={{
                border: `1px solid ${active ? 'var(--signal)' : 'var(--rule)'}`,
                background: active ? 'var(--fill-signal)' : 'var(--surface)',
                color: active ? 'var(--ink)' : 'var(--slate)',
              }}
            >
              {preset}
            </button>
          )
        })}
        <span className="ml-auto text-label text-slate">
          {canManageRoles
            ? 'You can grant every role.'
            : 'Only an owner can change roles.'}
        </span>
      </div>

      <div className="mt-6 overflow-x-auto rounded-sm border border-rule bg-surface">
        <div className="min-w-[1100px]">
          <div className="flex items-end border-b border-rule px-4 py-3">
            <div className="min-w-[200px] flex-1 text-micro uppercase text-slate">Person</div>
            <div className="w-[148px] shrink-0 text-micro uppercase text-slate">Role</div>
            {COLUMNS.map((c) => (
              <div
                key={c.key}
                className="w-[116px] shrink-0 text-center text-micro uppercase text-slate"
                title={c.key}
              >
                {c.label}
              </div>
            ))}
          </div>

          {people.map((p) => {
            const dimmed = highlight !== null && p.roleName !== highlight
            return (
              <div
                key={p.id}
                className="flex items-center border-b border-rule px-4 py-2.5 transition-opacity duration-[80ms]"
                style={{ opacity: dimmed ? 0.4 : 1 }}
              >
                <div className="flex min-w-[200px] flex-1 items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-rule bg-paper text-[0.625rem] font-semibold text-slate">
                    {initialsOf(p.fullName)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-body leading-[1.5]">
                      {p.fullName}
                      {p.deactivated && (
                        <span className="ml-2 text-micro uppercase text-slate">Deactivated</span>
                      )}
                    </div>
                    <div className="truncate text-label text-slate">{p.email}</div>
                  </div>
                </div>

                <div className="w-[148px] shrink-0 pr-3">
                  <select
                    defaultValue={p.roleName}
                    disabled={!canManageRoles || p.roleLocked || pending}
                    aria-label={`Role for ${p.fullName}`}
                    onChange={(e) => changeRole(p.id, e.target.value)}
                    className="h-7 w-full rounded-sm border border-rule bg-surface px-1.5 text-label"
                    style={{
                      color: canManageRoles && !p.roleLocked ? 'var(--ink)' : 'var(--slate)',
                      cursor: canManageRoles && !p.roleLocked ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {PRESETS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {p.roleLocked && (
                    <div className="mt-1 text-[0.6875rem] leading-[1.3] text-slate">
                      There must be at least one owner.
                    </div>
                  )}
                </div>

                {COLUMNS.map((c) => {
                  const on = p.permissions.includes(c.key)
                  return (
                    <div key={c.key} className="flex w-[116px] shrink-0 justify-center">
                      <span
                        aria-label={`${p.fullName} ${on ? 'has' : 'does not have'} ${c.key}`}
                        title={c.key}
                        className="flex size-[18px] items-center justify-center rounded-sm text-[0.625rem] font-semibold text-white"
                        style={{
                          border: `1px solid ${on ? 'var(--signal)' : 'var(--rule)'}`,
                          background: on ? 'var(--signal)' : 'transparent',
                        }}
                      >
                        {on ? '✓' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-label text-slate">
          {error}
        </p>
      )}

      <p className="mt-3 max-w-prose text-label text-slate">
        Permissions come from roles, so a cell changes when the role does — there are no
        per-person overrides. Permissions are enforced on the server; hiding controls is
        presentation only.
      </p>
    </div>
  )
}
