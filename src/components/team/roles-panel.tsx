'use client'

import { useActionState, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import type { RoleFormState } from '@/app/(app)/team/actions'
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/permissions'

export interface RoleRow {
  id: string
  name: string
  isSystemRole: boolean
  permissionKeys: PermissionKey[]
  memberCount: number
}

/**
 * Managing the org's roles (§3).
 *
 * The permission vocabulary is fixed in code — a key means something only
 * because there is code enforcing it — so this creates *bundles* of that
 * vocabulary, not new keys. That is the whole difference between a role
 * system an owner can safely operate and one that invents permissions
 * nothing checks.
 *
 * Grouped by what the permission is about rather than listed as fourteen
 * raw keys, because "meeting.edit.any" is not a sentence and an owner
 * choosing what a GFX role may do should not have to parse dotted paths.
 */
const GROUPS: { heading: string; keys: { key: PermissionKey; label: string; help: string }[] }[] = [
  {
    heading: 'Meetings',
    keys: [
      { key: 'meeting.view.own', label: 'See their own', help: 'Meetings they are on.' },
      { key: 'meeting.view.all', label: 'See everyone’s', help: 'The whole team calendar.' },
      { key: 'meeting.create.own', label: 'Book their own', help: 'Only themselves on it.' },
      { key: 'meeting.create.any', label: 'Book for others', help: 'Put teammates on a meeting.' },
      { key: 'meeting.edit.own', label: 'Edit their own', help: 'Move or change theirs.' },
      { key: 'meeting.edit.any', label: 'Edit anyone’s', help: 'Move or change any meeting.' },
      { key: 'meeting.delete.own', label: 'Cancel their own', help: '' },
      { key: 'meeting.delete.any', label: 'Cancel anyone’s', help: '' },
    ],
  },
  {
    heading: 'Transcripts',
    keys: [
      { key: 'transcript.view.own', label: 'Their own', help: '' },
      { key: 'transcript.view.all', label: 'Everyone’s', help: '' },
    ],
  },
  {
    heading: 'Administration',
    keys: [
      { key: 'client.manage', label: 'Clients', help: 'Add and edit client records.' },
      { key: 'user.invite', label: 'Add people', help: 'Create accounts.' },
      { key: 'user.manage', label: 'Assign roles', help: 'Move people between roles.' },
      {
        key: 'role.manage',
        label: 'Manage roles',
        help: 'Create roles and change what they grant. Give sparingly.',
      },
    ],
  },
]

/** Anything the groups forgot, so a new key cannot become invisible here. */
const GROUPED = new Set(GROUPS.flatMap((g) => g.keys.map((k) => k.key)))
const UNGROUPED = PERMISSION_KEYS.filter((k) => !GROUPED.has(k))

const CONTROL =
  'h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 cursor-pointer rounded-sm btn-signal px-3 text-label font-semibold disabled:opacity-60"
    >
      {pending ? busy : idle}
    </button>
  )
}

function Error({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-sm border border-live px-3 py-2 text-label font-medium text-live"
      style={{ borderLeftWidth: 2 }}
    >
      {message}
    </p>
  )
}

function Checkboxes({ selected }: { selected: Set<string> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {GROUPS.map((group) => (
        <div key={group.heading}>
          <div className="text-micro uppercase text-slate">{group.heading}</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {group.keys.map(({ key, label, help }) => (
              <label key={key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="permissionKeys"
                  value={key}
                  defaultChecked={selected.has(key)}
                  className="mt-[3px]"
                />
                <span className="min-w-0">
                  <span className="block text-label leading-[1.3]">{label}</span>
                  {help && (
                    <span className="block text-[0.6875rem] leading-[1.3] text-slate">{help}</span>
                  )}
                </span>
              </label>
            ))}
            {group.heading === 'Administration' &&
              UNGROUPED.map((key) => (
                <label key={key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="permissionKeys"
                    value={key}
                    defaultChecked={selected.has(key)}
                    className="mt-[3px]"
                  />
                  <span className="text-label leading-[1.3]">{key}</span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function RolesPanel({
  roles,
  onCreate,
  onSetPermissions,
  onRename,
  onDelete,
}: {
  roles: RoleRow[]
  onCreate: (prev: RoleFormState, form: FormData) => Promise<RoleFormState>
  onSetPermissions: (prev: RoleFormState, form: FormData) => Promise<RoleFormState>
  onRename: (roleId: string, name: string) => Promise<RoleFormState>
  onDelete: (roleId: string) => Promise<RoleFormState>
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [createState, createAction] = useActionState<RoleFormState, FormData>(onCreate, {})

  function remove(role: RoleRow) {
    setRowError(null)
    startTransition(async () => {
      const result = await onDelete(role.id)
      if (result.error) setRowError(result.error)
    })
  }

  function rename(role: RoleRow) {
    const next = window.prompt('Rename role', role.name)
    if (!next || next === role.name) return
    setRowError(null)
    startTransition(async () => {
      const result = await onRename(role.id, next)
      if (result.error) setRowError(result.error)
    })
  }

  return (
    <section className="rounded-sm border border-rule bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-micro uppercase text-slate">Roles</h2>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v)
            setEditing(null)
          }}
          className="h-7 cursor-pointer rounded-sm border border-rule px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal"
        >
          {adding ? 'Cancel' : '+ New role'}
        </button>
      </div>

      <p className="mt-2 text-label text-slate">
        A role is a named bundle of permissions. Owner, Manager and Member are built in and
        cannot be removed, but what they grant is yours to change.
      </p>

      {rowError && (
        <div className="mt-3">
          <Error message={rowError} />
        </div>
      )}

      {adding && (
        <form action={createAction} className="animate-rise-in mt-4 rounded-sm border border-rule p-4">
          {createState.error && <Error message={createState.error} />}
          <label className="block max-w-[280px]">
            <span className="mb-1 block text-micro uppercase text-slate">Role name</span>
            <input name="name" required maxLength={60} placeholder="GFX" className={CONTROL} />
          </label>
          <div className="mt-4">
            <Checkboxes selected={new Set(['meeting.view.own', 'meeting.create.own', 'meeting.edit.own', 'meeting.delete.own'])} />
          </div>
          <div className="mt-4">
            <Submit idle="Create role" busy="Creating" />
          </div>
        </form>
      )}

      <div className="mt-4 flex flex-col">
        {roles.map((role) => (
          <div key={role.id} className="border-t border-rule py-3">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="text-body font-medium">{role.name}</span>
                {role.isSystemRole && (
                  <span className="ml-2 text-micro uppercase text-slate">built in</span>
                )}
                <span className="ml-2 font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
                  {role.permissionKeys.length} permission
                  {role.permissionKeys.length === 1 ? '' : 's'} · {role.memberCount}{' '}
                  {role.memberCount === 1 ? 'person' : 'people'}
                </span>
              </span>

              <button
                type="button"
                onClick={() => {
                  setEditing(editing === role.id ? null : role.id)
                  setAdding(false)
                }}
                className="h-7 shrink-0 cursor-pointer rounded-sm border border-rule px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal"
              >
                {editing === role.id ? 'Close' : 'Permissions'}
              </button>

              {!role.isSystemRole && (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => rename(role)}
                    className="h-7 shrink-0 cursor-pointer rounded-sm border border-rule px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal disabled:opacity-50"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(role)}
                    className="h-7 shrink-0 cursor-pointer rounded-sm border border-rule px-2.5 text-label font-medium text-live transition-colors duration-[80ms] hover:border-live disabled:opacity-50"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>

            {editing === role.id && (
              <EditPermissions role={role} onSetPermissions={onSetPermissions} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Its own component so `useActionState` is per role rather than shared —
 * one hook across every row would show the error from editing Manager
 * underneath Member.
 */
function EditPermissions({
  role,
  onSetPermissions,
}: {
  role: RoleRow
  onSetPermissions: (prev: RoleFormState, form: FormData) => Promise<RoleFormState>
}) {
  const [state, action] = useActionState<RoleFormState, FormData>(onSetPermissions, {})
  const selected = new Set<string>(role.permissionKeys)

  return (
    <form action={action} className="animate-rise-in mt-3 rounded-sm border border-rule p-4">
      <input type="hidden" name="roleId" value={role.id} />
      {state.error && <Error message={state.error} />}
      <Checkboxes selected={selected} />
      <div className="mt-4 flex items-center gap-3">
        <Submit idle="Save permissions" busy="Saving" />
        <span className="text-label text-slate">
          Applies to everyone holding {role.name} the next time they load a page.
        </span>
      </div>
    </form>
  )
}
