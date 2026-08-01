# MediaClicks Operations

Internal scheduling and meeting-operations platform for MediaClicks, a social
media marketing agency. Replaces scattered calendars, WhatsApp threads and
manual notes with one system.

**Not** a CRM, project manager, or invoicing tool. Scope is scheduling,
meeting logistics, and meeting intelligence.

Full specification: [`docs/mediaclicks-spec.md`](docs/mediaclicks-spec.md).
Visual direction: [`docs/mediaclicks-design-brief.md`](docs/mediaclicks-design-brief.md).

---

## Status

Phase 1 (Foundation), in progress. Nothing is deployed yet.

| Step | State |
|---|---|
| Project structure, token system, test harness | done |
| Drizzle schema + migrations + seed | not started |
| Permission model + Auth.js | not started |
| App shell (Rail, nav, avatar menu) | not started |

Phases 2–6 (calendar, notifications, conferencing, assistant, polish) are
untouched. See §6 of the spec for the build order.

---

## Architecture

One Next.js service. There is no Python service, and that is a deliberate
reversal of the original spec — see
[ADR 0001](docs/adr/0001-single-typescript-service.md). Short version: the
workload that justified a second deployable (transcript summarisation) was
deferred by the client, and the assistant alone does not justify a network
boundary through the authorization path.

```
Next.js 15 (App Router, RSC)
├── src/app          routes; server components by default
├── src/components   presentation
├── src/server       everything server-only, enforced by `import 'server-only'`
│   ├── db           Drizzle schema, client, seed
│   ├── auth         Auth.js config, argon2, session
│   └── authz        permission keys, can(), requirePermission()
└── src/lib          isomorphic helpers
        │
        └── Postgres (Supabase / Neon), Drizzle ORM
```

A client component that imports anything under `src/server` fails at build
rather than shipping a connection string to the browser.

---

## Local setup

Requires Node 20.9+ and a Postgres 15+ database.

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL and AUTH_SECRET
npx auth secret                # generates AUTH_SECRET
npm run dev
```

Database commands land at Stop 2:

```bash
npm run db:generate   # write a migration from the schema
npm run db:migrate    # apply migrations
npm run db:seed       # roles, permissions, day-one Owner
```

Verification:

```bash
npm run typecheck && npm run lint && npm test
```

---

## Design system

The token layer in [`src/app/globals.css`](src/app/globals.css) is extracted
from the Claude Design project, not hand-authored. Values are copied verbatim
from the design's `:root` and `[data-theme="dark"]` blocks so the two cannot
drift.

Three rules from the brief are enforced in the token layer rather than left to
reviewer discipline:

- **`--live` magenta is reserved for time-criticality.** Four states only: the
  playhead, a meeting in progress, one starting within 30 minutes, one
  overdue. It never fills a button.
- **2px radius everywhere.** The entire Tailwind radius scale is collapsed to
  2px, so shadcn/ui components — which reach for `rounded-md` and
  `rounded-lg` — inherit the geometry instead of reintroducing rounded
  consumer-app corners. `rounded-full` still gives the avatar its circle.
- **One shadow.** `shadow-float`, on floating layers only.

Weight and letter-spacing travel with each font-size token, so a component
cannot render `display-lg` at the wrong weight.

---

## Trade-offs taken, and why

**Next 15, not 16.** npm's `latest` resolves to Next 16. Pinned to 15 because
the spec fixes it (§1) and because Auth.js v5 is still beta and is tested
against 15. Stacking an unvetted major on a beta auth library buys nothing
here. Revisit in Phase 6.

**`users.email` is globally unique, not unique per organisation.** Credentials
login resolves an account from an email alone, so per-org uniqueness makes
that lookup ambiguous. The cost is that one person cannot belong to two
organisations. Correct for a single-agency internal tool; wrong for
multi-tenant SaaS. Escape hatch if that changes: move authentication identity
into its own table and let a person hold several org memberships.

**`exactOptionalPropertyTypes` is off.** The rest of TypeScript's strictness
is on, plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch` and `verbatimModuleSyntax`. This one flag is
excluded because it fights the ambient types in Auth.js and Drizzle in ways
that produce casts rather than safety — a net loss.

**Google OAuth deferred to Phase 4.** The design's login screen has a
"Continue with Google" button. It is not built in Phase 1, because the Google
grant exists to create Meet links (§4.2, calendar scope + encrypted refresh
tokens) and there is nothing to consume it yet. `users.password_hash` is
already nullable so the account model is ready. Shipping a dead control would
be worse than shipping none.

**Two npm audit advisories are unresolved.** Both are transitive dependencies
inside Next itself (`postcss`, `sharp`). npm's proposed remediation is
downgrading Next to 9.3.3, which is not a fix. They clear when Next ships a
patched release.
