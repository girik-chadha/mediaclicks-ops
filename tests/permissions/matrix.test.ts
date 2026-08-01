import { describe, expect, it } from 'vitest'
import {
  FLAT_PERMISSIONS,
  PERMISSION_KEYS,
  SCOPED_ACTIONS,
  SCOPED_KEYS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_PERMISSIONS,
  can,
  type Actor,
  type FlatPermission,
  type PermissionKey,
  type ScopedAction,
  type Subject,
  type SystemRoleName,
} from '@/lib/permissions'

/**
 * The permission matrix, generated rather than enumerated.
 *
 * Every assertion below comes from iterating a cartesian product against a
 * declared expectation table. Hand-written cases miss exactly the combination
 * that matters, and — more importantly — a generated matrix fails the day
 * someone adds a permission key without deciding who holds it.
 *
 * The expectation tables are written out independently of
 * SYSTEM_ROLE_PERMISSIONS on purpose. Deriving them from the implementation
 * would make these tests tautological: they would prove the code agrees with
 * itself. Changing a role bundle should break this file and force a decision.
 */

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const ME = 'user-me'
const SOMEONE_ELSE = 'user-other'

function actorFor(role: SystemRoleName, orgId = ORG): Actor {
  return {
    id: ME,
    orgId,
    permissions: new Set<PermissionKey>(SYSTEM_ROLE_PERMISSIONS[role]),
  }
}

/** How the actor relates to the subject. */
const RELATIONS = ['creator', 'attendee', 'stranger'] as const
type Relation = (typeof RELATIONS)[number]

function subjectFor(relation: Relation, orgId = ORG): Subject {
  switch (relation) {
    case 'creator':
      return { orgId, createdByUserId: ME, attendeeIds: [ME] }
    case 'attendee':
      return { orgId, createdByUserId: SOMEONE_ELSE, attendeeIds: [ME] }
    case 'stranger':
      return { orgId, createdByUserId: SOMEONE_ELSE, attendeeIds: [SOMEONE_ELSE] }
  }
}

/* ── Declared expectations ─────────────────────────────────────────────── */

/** Which role holds which raw key (§3). Independent of the seed constant. */
const GRANTS: Record<PermissionKey, Record<SystemRoleName, boolean>> = {
  'meeting.create.own': { Owner: true, Manager: true, Member: true },
  'meeting.create.any': { Owner: true, Manager: true, Member: false },
  'meeting.edit.own': { Owner: true, Manager: true, Member: true },
  'meeting.edit.any': { Owner: true, Manager: true, Member: false },
  'meeting.delete.own': { Owner: true, Manager: true, Member: true },
  'meeting.delete.any': { Owner: true, Manager: true, Member: false },
  'meeting.view.own': { Owner: true, Manager: true, Member: true },
  // §3 gives Member the whole team calendar deliberately.
  'meeting.view.all': { Owner: true, Manager: true, Member: true },
  'transcript.view.own': { Owner: true, Manager: true, Member: true },
  'transcript.view.all': { Owner: true, Manager: true, Member: false },
  'client.manage': { Owner: true, Manager: true, Member: false },
  'user.invite': { Owner: true, Manager: true, Member: false },
  'user.manage': { Owner: true, Manager: false, Member: false },
  'role.manage': { Owner: true, Manager: false, Member: false },
}

/** What can() returns for each scoped action, by role and relationship. */
const SCOPED_EXPECTED: Record<
  ScopedAction,
  Record<SystemRoleName, Record<Relation, boolean>>
> = {
  // Member has create.own only, and "own" here means the attendee set is
  // just the actor — so the stranger subject (attendees: someone else) is
  // the case that needs create.any. §4.1.1.
  'meeting.create': {
    Owner: { creator: true, attendee: true, stranger: true },
    Manager: { creator: true, attendee: true, stranger: true },
    Member: { creator: true, attendee: true, stranger: false },
  },
  // Being invited does not let you edit. Only authorship does.
  'meeting.edit': {
    Owner: { creator: true, attendee: true, stranger: true },
    Manager: { creator: true, attendee: true, stranger: true },
    Member: { creator: true, attendee: false, stranger: false },
  },
  'meeting.delete': {
    Owner: { creator: true, attendee: true, stranger: true },
    Manager: { creator: true, attendee: true, stranger: true },
    Member: { creator: true, attendee: false, stranger: false },
  },
  // Member holds meeting.view.all, so the team calendar is visible.
  'meeting.view': {
    Owner: { creator: true, attendee: true, stranger: true },
    Manager: { creator: true, attendee: true, stranger: true },
    Member: { creator: true, attendee: true, stranger: true },
  },
  // But transcripts are not: Member has transcript.view.own only, so they
  // reach transcripts of meetings they created or attended, and no others.
  'transcript.view': {
    Owner: { creator: true, attendee: true, stranger: true },
    Manager: { creator: true, attendee: true, stranger: true },
    Member: { creator: true, attendee: true, stranger: false },
  },
}

const FLAT_EXPECTED: Record<FlatPermission, Record<SystemRoleName, boolean>> = {
  'client.manage': { Owner: true, Manager: true, Member: false },
  'user.invite': { Owner: true, Manager: true, Member: false },
  'user.manage': { Owner: true, Manager: false, Member: false },
  'role.manage': { Owner: true, Manager: false, Member: false },
}

/* ── Exhaustiveness guards ─────────────────────────────────────────────── */

describe('exhaustiveness', () => {
  it('routes every permission key through either a flat check or a scoped action', () => {
    // Adding a 15th key and forgetting to wire it into can() would otherwise
    // fail silently as a permanent deny.
    const routed = new Set<string>([...FLAT_PERMISSIONS, ...SCOPED_KEYS])
    const unrouted = PERMISSION_KEYS.filter((k) => !routed.has(k))
    expect(unrouted).toEqual([])
  })

  it('declares an expectation for every permission key', () => {
    // Fails loudly the day someone adds a key without deciding who holds it.
    const undeclared = PERMISSION_KEYS.filter((k) => !(k in GRANTS))
    expect(undeclared).toEqual([])
  })

  it('declares an expectation for every scoped action and flat permission', () => {
    expect(SCOPED_ACTIONS.filter((a) => !(a in SCOPED_EXPECTED))).toEqual([])
    expect(FLAT_PERMISSIONS.filter((p) => !(p in FLAT_EXPECTED))).toEqual([])
  })

  it('declares no expectation for a key that does not exist', () => {
    const keys = new Set<string>(PERMISSION_KEYS)
    expect(Object.keys(GRANTS).filter((k) => !keys.has(k))).toEqual([])
  })
})

/* ── The matrix ────────────────────────────────────────────────────────── */

/* Every expectation lookup happens inside the assertion, never while
   generating the case. An undeclared key would otherwise throw during
   collection, which aborts the whole file — including the exhaustiveness
   guards that exist to explain exactly that mistake. */

describe('seeded role bundles', () => {
  for (const role of SYSTEM_ROLE_NAMES) {
    for (const key of PERMISSION_KEYS) {
      it(`${role} — ${key}`, () => {
        const row = GRANTS[key]
        expect(row, `${key} has no declared expectation in GRANTS`).toBeDefined()
        expect(SYSTEM_ROLE_PERMISSIONS[role].includes(key)).toBe(row![role])
      })
    }
  }
})

describe('can() — scoped actions', () => {
  for (const role of SYSTEM_ROLE_NAMES) {
    for (const action of SCOPED_ACTIONS) {
      for (const relation of RELATIONS) {
        it(`${role} — ${action} as ${relation}`, () => {
          const expected = SCOPED_EXPECTED[action]?.[role]?.[relation]
          expect(
            expected,
            `${action}/${role}/${relation} has no declared expectation`,
          ).toBeDefined()
          expect(can(actorFor(role), action, subjectFor(relation))).toBe(expected)
        })
      }
    }
  }
})

describe('can() — flat permissions', () => {
  for (const role of SYSTEM_ROLE_NAMES) {
    for (const permission of FLAT_PERMISSIONS) {
      it(`${role} — ${permission}`, () => {
        const expected = FLAT_EXPECTED[permission]?.[role]
        expect(expected, `${permission}/${role} has no declared expectation`).toBeDefined()
        expect(can(actorFor(role), permission)).toBe(expected)
      })
    }
  }
})

describe('tenant isolation', () => {
  for (const role of SYSTEM_ROLE_NAMES) {
    for (const action of SCOPED_ACTIONS) {
      for (const relation of RELATIONS) {
        it(`${role} cannot ${action} across orgs, even as ${relation}`, () => {
          // Same actor, same relationship, subject in another organisation.
          // No grant may pass this — including every one Owner holds.
          expect(can(actorFor(role), action, subjectFor(relation, OTHER_ORG))).toBe(false)
        })
      }
    }
  }

  it('denies even when the actor holds every permission that exists', () => {
    const superuser: Actor = {
      id: ME,
      orgId: ORG,
      permissions: new Set<PermissionKey>(PERMISSION_KEYS),
    }
    for (const action of SCOPED_ACTIONS) {
      expect(can(superuser, action, subjectFor('creator', OTHER_ORG))).toBe(false)
    }
  })
})

/* ── Properties ────────────────────────────────────────────────────────── */

describe('properties', () => {
  it('grants nothing to an actor with no permissions', () => {
    const nobody: Actor = { id: ME, orgId: ORG, permissions: new Set() }
    for (const action of SCOPED_ACTIONS) {
      for (const relation of RELATIONS) {
        expect(can(nobody, action, subjectFor(relation))).toBe(false)
      }
    }
    for (const permission of FLAT_PERMISSIONS) {
      expect(can(nobody, permission)).toBe(false)
    }
  })

  it('is monotonic: anything Member can do, Manager and Owner can too', () => {
    // Catches a seed-data edit that accidentally inverts a grant.
    for (const action of SCOPED_ACTIONS) {
      for (const relation of RELATIONS) {
        const subject = subjectFor(relation)
        const member = can(actorFor('Member'), action, subject)
        const manager = can(actorFor('Manager'), action, subject)
        const owner = can(actorFor('Owner'), action, subject)
        if (member) expect(manager).toBe(true)
        if (manager) expect(owner).toBe(true)
      }
    }
    for (const permission of FLAT_PERMISSIONS) {
      const member = can(actorFor('Member'), permission)
      const manager = can(actorFor('Manager'), permission)
      if (member) expect(manager).toBe(true)
      if (manager) expect(can(actorFor('Owner'), permission)).toBe(true)
    }
  })

  it('lets an elevated grant answer without regard to ownership', () => {
    const editor: Actor = {
      id: ME,
      orgId: ORG,
      permissions: new Set<PermissionKey>(['meeting.edit.any']),
    }
    for (const relation of RELATIONS) {
      expect(can(editor, 'meeting.edit', subjectFor(relation))).toBe(true)
    }
  })

  it('restricts an own grant to what the actor owns', () => {
    const editor: Actor = {
      id: ME,
      orgId: ORG,
      permissions: new Set<PermissionKey>(['meeting.edit.own']),
    }
    expect(can(editor, 'meeting.edit', subjectFor('creator'))).toBe(true)
    expect(can(editor, 'meeting.edit', subjectFor('attendee'))).toBe(false)
    expect(can(editor, 'meeting.edit', subjectFor('stranger'))).toBe(false)
  })

  it('treats an absent attendee list on create as "just me"', () => {
    const creator: Actor = {
      id: ME,
      orgId: ORG,
      permissions: new Set<PermissionKey>(['meeting.create.own']),
    }
    expect(can(creator, 'meeting.create', { orgId: ORG, createdByUserId: ME })).toBe(true)
  })

  it('requires create.any as soon as one other person is added', () => {
    const creator: Actor = {
      id: ME,
      orgId: ORG,
      permissions: new Set<PermissionKey>(['meeting.create.own']),
    }
    expect(
      can(creator, 'meeting.create', {
        orgId: ORG,
        createdByUserId: ME,
        attendeeIds: [ME, SOMEONE_ELSE],
      }),
    ).toBe(false)
  })
})
