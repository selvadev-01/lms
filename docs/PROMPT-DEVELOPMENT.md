# Common Prompt — LMS User Story Development

One reusable prompt for building any user story as a complete full-stack vertical
slice. Fill the four `{{...}}` parameters and paste.

**Start here:** Module 01, screen `Sign-In`. It is the only story with no
upstream dependency, and building it establishes the auth foundation every other
module assumes.

---

## How to use

1. Pick a story file from `docs/user-stories/`.
2. Fill the parameters at the top of the prompt.
3. Run it. One story per run — never batch several screens into one pass.
4. The slice is done when `pnpm verify` is green and the story's Gherkin
   scenarios exist as passing tests.

**Order for Module 01:** `Sign-In` → `Forgot-Password` → `Reset-Password` →
`Change-Password` → `Active-Sessions-Session-Management` →
`Field-Employee-GPS-Check-in`. Sign-In first — the other five depend on the
session and user tables it creates.

---

## The prompt

````text
You are building a vertical slice of the LMS (Loan Management System) — a
multi-tenant NBFC loan-management platform for Indian lending operations.

## Parameters

STORY_FILE:   {{docs/user-stories/01 - Authentication & Session Management/Sign-In.md}}
MODULE:       {{01 — Authentication & Session Management}}
FEATURE_SLUG: {{auth}}          # maps to apps/web/src/features/{{auth}} and apps/api/src/{{auth}}
SCREEN:       {{Sign In}}

## Step 0 — Read before writing any code

1. **{{STORY_FILE}}** — the specification. Every rule, field, state, Gherkin
   scenario, and acceptance criterion in it is in scope. Read it completely.
2. `docs/_shared/Database-Schema.md` — the authoritative table and column
   definitions. Your Prisma models must match these names exactly.
3. `docs/_shared/State-Machines.md` — the canonical status values. Never invent
   a status.
4. `docs/_shared/NFR.md` — cross-cutting requirements: performance budgets,
   offline behaviour, security, PII, audit immutability, financial integrity.
5. `docs/guides/TEMPLATE-GUIDE.md` §2.1 and `docs/guides/NEW-PROJECT.md` §5 —
   the feature-first architecture rules this repo enforces.
6. The existing code you are extending, so you match its conventions rather than
   introducing a second style.

Then state, in five lines or fewer, what you are about to build and which
Open Questions from the story block you. **Do not guess an answer to an Open
Question** — list it, apply the safest configurable default, and mark it
`// TODO(open-question):` in code.

## Step 1 — The stack you are building into

This is a pnpm + Turborepo monorepo. Node 20+, TypeScript strict everywhere.

```
apps/api/          NestJS 11        — REST API. Currently a bare scaffold:
                                      only app.module/controller/service exist.
                                      No database layer yet.
apps/web/          Next.js 16       — App Router, React 19, Tailwind v4.
                                      TailAdmin-derived UI shell, feature-first.
packages/types/       @lms/types       shared TypeScript types / DTO contracts
packages/validation/  @lms/validation  shared zod schemas (used by BOTH api + web)
packages/constants/   @lms/constants   enums, statuses, permission keys
packages/ui/          @lms/ui          shared presentational primitives
```

Already installed on web: `react-hook-form`, `zod`, `@hookform/resolvers`,
`@t3-oss/env-nextjs`, Playwright, Vitest + Testing Library.
Already installed on api: Jest, supertest, `@nestjs/testing`.

Existing feature folders in `apps/web/src/features/`: accounting, auth,
collections, customers, dashboard, loans, reports, settings.

**If the slice needs a package that is not installed** (e.g. Prisma,
`@nestjs/jwt`, `@nestjs/passport`, `argon2`), install it in the correct
workspace with `pnpm --filter <pkg> add ...` — never at the root, and never with
npm or yarn. State what you added and why.

## Step 2 — Build order

Build bottom-up. Each layer compiles before you start the next.

### 2.1 Contracts — `packages/`
- `@lms/constants` — status enums and permission keys from the story's
  "Table Only (Not for UI)" section and `State-Machines.md`.
- `@lms/types` — the request/response DTO types for this screen.
- `@lms/validation` — zod schemas encoding the story's **Field Rules** section.
  One schema per form/endpoint. These are shared: the API validates with them and
  the web form resolves against them. Write them once, here.

### 2.2 Data layer — `apps/api`
- Prisma schema models for the tables this story touches, matching
  `docs/_shared/Database-Schema.md` column-for-column.
- If this is the first story, initialise Prisma and the Postgres connection,
  and create the migration. Add `DATABASE_URL` to the env schema.
- **Money is `BigInt` integer paise.** Never `Float`, never `Decimal` rupees.
- **EMI due dates are `Date` (DATE-only), Asia/Kolkata.** Not timestamps.
- Audit tables are append-only — no update or delete paths.

### 2.3 API — `apps/api/src/{{FEATURE_SLUG}}/`
```
{{FEATURE_SLUG}}/
  {{feature}}.module.ts
  {{feature}}.controller.ts     thin — validate, delegate, return
  {{feature}}.service.ts        business rules from the story
  dto/                          request/response, typed from @lms/types
  guards/                       auth + permission + scope
  {{feature}}.service.spec.ts
```
Enforce, server-side, in this order on every endpoint:
1. **Authenticated?** — reject before anything else.
2. **Authorized?** — the caller's role holds the required permission.
   Being logged in never implies being permitted.
3. **In scope?** — organization and branch isolation applied in the query
   itself, not filtered after fetch. A missing scope clause is a data breach.
4. **State valid?** — the entity's current status permits this transition, per
   `State-Machines.md`.
5. **Audit** — every mutation writes an audit record: actor, org, action,
   resource, before/after, timestamp.

Financial invariants, wherever money moves:
- integer paise only
- every movement posts double-entry lines summing to zero
- payment posting honours an `Idempotency-Key` header
- ledger rows are append-only; corrections are new reversing entries

Secrets and passwords are never logged, never returned in a response, never
stored in plaintext.

### 2.4 UI — `apps/web/src/features/{{FEATURE_SLUG}}/`
```
{{FEATURE_SLUG}}/
  components/     the screen and its parts
  api/            server-only reads through src/lib/api-fetch.ts
  schemas/        re-export from @lms/validation — do not redefine
  hooks/
  types.ts
  index.ts        the ONLY public surface of this feature
```
Then the route in `apps/web/src/app/`:
- authenticated screens go inside the `(admin)` group to inherit the shell
- auth screens go in `(full-width-pages)/(auth)`
- `page.tsx` imports from the feature and does little else
- export `metadata = { title: "{{SCREEN}}" }` — bare title, the root layout
  supplies the template

**Reuse, do not rebuild.** These already exist:
`@lms/ui` primitives (Button, Badge, Alert, Avatar, Modal, Table),
`apps/web/src/components/form/input/*`, `form/switch`, `form/group-input`,
`components/common/ComponentCard`, `components/common/PageBreadCrumb`,
`@/hooks/useModal`, and 58 icons at `@/icons`.

Forms use `react-hook-form` + `zodResolver` against the `@lms/validation`
schema. Wrap the existing input primitives — they are presentational, so wrap
rather than replace.

Build every state the story implies: loading, empty, error, permission-denied,
and success. Add `loading.tsx` and `error.tsx` for the route.

Add the sidebar nav entry in `apps/web/src/layout/AppSidebar.tsx`, gated on the
same permission the API guard checks — so nav and authorization cannot drift.

**UI hiding is presentation, never enforcement.** Every rule enforced in the UI
must also be enforced server-side.

### 2.5 Tests — the Gherkin scenarios are the test plan
The story's numbered scenarios are not illustrative. Each one becomes a test.
- **Service unit tests** (`apps/api`, Jest) — business rules, state transitions,
  validation, failure paths.
- **Scope isolation tests** — explicitly assert that Branch A cannot read Branch
  B, and Organization A cannot read Organization B. These are the tests that
  matter most; write them even when the story feels obvious.
- **Component tests** (`apps/web`, Vitest + Testing Library) — field validation,
  mandatory-field messages, the states from 2.4.
- **E2E** (Playwright) — the happy path plus the primary denial path.

Name each test after its scenario so traceability survives:
`it("Scenario 7: Branch Admin reaches the configured failed-login threshold")`.

Cover, at minimum: every Mandatory Field Validation example row, every Failure
Path scenario, every Permission Denial scenario, every Scope Integrity scenario,
and every Audit Logging scenario.

## Step 3 — Hard rules

1. **The story is the spec.** Do not add features it does not describe, and do
   not silently drop ones it does. If something is genuinely unbuildable, say so
   and build the rest.
2. **Never invent a value the story left open.** Thresholds, lock durations,
   session lifetimes, retention periods — if it is an Open Question, make it
   configurable, pick a conservative default, and mark it
   `// TODO(open-question): <question>`.
3. **Column names come from `Database-Schema.md`.** Status values come from
   `State-Machines.md`. No improvised names.
4. **Money is integer paise (BigInt).** No floats anywhere in the money path.
5. **Scope in the query.** Organization and branch filters belong in the
   database call, never applied afterwards in JavaScript.
6. **Audit every mutation.** Append-only, immutable.
7. **Respect module boundaries.** The story names what it does not own — do not
   build another module's screens along the way.
8. **Feature-first imports.** Import from a feature's `index.ts`. Cross-feature
   deep imports are banned. A component moves to `@lms/ui` only when a *third*
   feature needs it.
9. **`app/` holds routes only.** Business code lives in `features/`.
10. **No secrets in code.** New env vars go through `src/lib/env.ts` (t3-env +
    zod) and get names-only entries in `.env.example`.
11. **Accessibility is a gate, not advice.** Real `<button>` elements, labelled
    inputs, keyboard reachable, WCAG 2.2 AA. The base has a known regression
    here — do not reintroduce it.
12. **Match the surrounding code.** Same naming, same file layout, same comment
    density as the existing modules.

## Step 4 — Definition of done

Run and report the actual output — do not claim green without running it:

```bash
pnpm verify        # lint -> typecheck -> test -> build -> format:check
pnpm test:e2e      # Playwright
```

Then confirm each line, honestly:
- [ ] Every acceptance criterion in {{STORY_FILE}} is implemented or explicitly
      listed as not-done with a reason.
- [ ] Every Gherkin scenario has a correspondingly named test, and it passes.
- [ ] Scope isolation is proven by a test, not by inspection.
- [ ] Every mutation writes an audit record.
- [ ] No plaintext secret is stored, logged, or returned.
- [ ] No hardcoded value that belongs to an Open Question.
- [ ] `pnpm verify` is green.

Finally, report:
1. Files created and modified, grouped by workspace.
2. Packages installed, and why.
3. Open Questions that blocked you, and the default you applied to each.
4. What the next story in this module needs from what you just built.
````

---

## Parameter reference

| Story                              | FEATURE_SLUG | Route group                 |
| ---------------------------------- | ------------ | --------------------------- |
| Sign-In                            | `auth`       | `(full-width-pages)/(auth)` |
| Forgot-Password                    | `auth`       | `(full-width-pages)/(auth)` |
| Reset-Password                     | `auth`       | `(full-width-pages)/(auth)` |
| Change-Password                    | `auth`       | `(admin)`                   |
| Active-Sessions-Session-Management | `auth`       | `(admin)`                   |
| Field-Employee-GPS-Check-in        | `auth`       | `(admin)`                   |
| Organizations-and-Branches         | `settings`   | `(admin)`                   |
| Users-Employees-Roles-Permissions  | `settings`   | `(admin)`                   |

---

## What Sign-In establishes for everything after it

The first run is heavier than the rest, because it creates the foundation the
other 16 modules assume:

- Prisma + Postgres connection and the first migration
- `organizations`, `branches`, `users`, `roles`, `permissions`,
  `role_permissions`, `user_roles` tables
- the session model and JWT issuing
- `apps/api` auth guard, permission guard, and org/branch scope guard
- `apps/web` middleware gating the `(admin)` route group
- the audit-log write path
- the shared zod + DTO + constants pattern across `packages/`

Every later story reuses these rather than rebuilding them. Budget accordingly:
Sign-In is a foundation slice, not a login form.

> **Note on the current state:** every `(admin)` route in `apps/web` is publicly
> reachable today — there is no middleware and no session. `apps/api` has no
> database layer at all. Sign-In closes both gaps.
