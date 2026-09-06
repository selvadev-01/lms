# Kickoff Prompt

Copy everything inside the block below into a **new Claude chat** opened at
`c:\projects\LMS_old`. Paste it as your first message.

It reads the specs, sets up the database, builds the backend and frontend
foundation, and delivers the Sign In user story end to end — without stopping
to ask.

---

```text
You are working on the LMS (Loan Management System) — a multi-tenant NBFC
loan-management platform for Indian lending operations.

Project root: c:\projects\LMS_old

This is the first development session. The repo is a green monorepo scaffold
with complete written specifications and almost no application code. Build the
foundation and deliver the first user story: Sign In.

Work straight through all five phases. Do not stop for approval between them.
Make sensible decisions and tell me what you decided at the end.

═══════════════════════════════════════════════════════════════════
PHASE 0 — READ (no code yet)
═══════════════════════════════════════════════════════════════════

Read these completely before writing anything:

1. docs/user-stories/01 - Authentication & Session Management/Sign-In.md
   THE SPECIFICATION. 679 lines: business rules, field rules, 36 Gherkin
   scenarios, acceptance criteria, 25 open questions. Everything in it is
   in scope.

2. docs/_shared/Database-Schema.md
   The authoritative PostgreSQL schema. Prisma models must match these table
   and column names exactly. Sections 3 (Tenant/Organization) and
   4 (Authentication/RBAC) are the ones you need.

3. docs/_shared/State-Machines.md
   Canonical status values. Never invent a status.

4. docs/_shared/NFR.md
   Sections 13 (Authentication), 14 (Authorization), 16 (PII Protection),
   18 (Audit Immutability).

5. docs/guides/TEMPLATE-GUIDE.md §2.1
   The feature-first architecture rules this repo enforces.

6. The code you are extending:
   - apps/api/src/                                (bare NestJS scaffold)
   - apps/web/src/lib/env.ts                      (t3-env schema)
   - apps/web/src/components/auth/SignInForm.tsx  (inert markup)
   - apps/web/src/app/(full-width-pages)/(auth)/  (existing auth routes)

Then continue straight into Phase 1.

═══════════════════════════════════════════════════════════════════
CURRENT STATE — verified. Take as given.
═══════════════════════════════════════════════════════════════════

Stack: pnpm 10.20 + Turborepo, Node 22, TypeScript strict.

PostgreSQL is provided by me — I will give you a working DATABASE_URL. Do not
try to install, provision, or containerise a database. No Docker.

  apps/api/   NestJS 11. Bare scaffold — app.module/controller/service/main
              only. No database, no Prisma, no auth, no modules.
  apps/web/   Next.js 16, React 19, Tailwind v4, App Router. LMS admin UI
              shell. Feature folders exist but are empty (.gitkeep only).
  packages/   @lms/types, @lms/validation, @lms/constants, @lms/ui,
              @lms/emi, @lms/config, @lms/design-tokens

Already installed — do not reinstall:
  web: react-hook-form, zod, @hookform/resolvers, @t3-oss/env-nextjs,
       Playwright, Vitest + Testing Library, tailwind-merge
  api: Jest, supertest, @nestjs/testing

Gaps you are closing:
  - No src/middleware.ts — every (admin) route is publicly reachable today
  - No database layer of any kind
  - SignInForm.tsx is non-functional markup
  - No .env.local exists

Baseline: `pnpm verify` = 32/32 tasks green. Keep it green.

═══════════════════════════════════════════════════════════════════
DECISIONS — already made. Use these, do not ask.
═══════════════════════════════════════════════════════════════════

The story has 25 Open Questions. These are answered:

  Mobile number format      E.164, stored as +91XXXXXXXXXX, normalised on input
  Mobile uniqueness         unique per organization (not global)
  Concurrent sessions       multiple allowed, each individually revocable
  Password hashing          argon2id
  Password policy           min 8 chars, at least one letter and one number
  Failed-login threshold    5 attempts
  Account lock duration     30 minutes, auto-unlock
  Lock counter reset        reset to 0 on successful login
  Lock applies to           all roles, uniformly
  Session idle timeout      30 minutes
  Session absolute lifetime 12 hours
  Login error message       one generic message for all failure causes
                            (never reveal whether an account exists)
  Password change           revokes all other sessions, keeps the current one
  Logout destination        /signin

Every one of these is CONFIGURABLE, not hardcoded — put them in config/env with
these values as defaults, and mark each with:
    // TODO(open-question): <the question> — default chosen, confirm with client

For anything else the story leaves open: pick the safest option, mark it the
same way, and list it in your final report.

═══════════════════════════════════════════════════════════════════
PHASE 1 — PRISMA SCHEMA + MIGRATION (all inside apps/api)
═══════════════════════════════════════════════════════════════════

The database layer belongs to the backend. Everything in this phase happens in
the apps/api workspace.

1. Install Prisma into the api workspace:
       pnpm --filter @lms/api add -D prisma
       pnpm --filter @lms/api add @prisma/client
       pnpm --filter @lms/api exec prisma init --datasource-provider postgresql
   Always use `pnpm --filter <pkg>`. Never install at the root. Never npm/yarn.

2. Create apps/api/.env with DATABASE_URL and AUTH_SECRET. Use this as the
   default DATABASE_URL and tell me clearly if it does not connect:
       DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lms_dev"
   Confirm .gitignore covers .env. Also add the NAMES ONLY (no values) to
   apps/web/.env.example.

3. Write apps/api/prisma/schema.prisma — the main work of this phase.
   Model these tables, matching docs/_shared/Database-Schema.md
   column-for-column, with correct relations, indexes and enums:

       organizations, branches, users, roles, permissions,
       role_permissions, user_roles, sessions, audit_logs

   Use @@map / @map so Prisma model names stay idiomatic while the underlying
   table and column names match the schema doc exactly.

   Conventions to establish now, project-wide:
     - Money is BigInt integer paise. Never Float, never Decimal rupees.
     - Calendar dates (EMI due dates) are @db.Date, Asia/Kolkata — not
       timestamps. Not used in this story, but set the pattern now.
     - audit_logs is append-only. No update path, no delete path, ever.
     - users.mobile_number is unique per organization:
       @@unique([organization_id, mobile_number])
     - Every table carries created_at / updated_at unless the schema doc says
       otherwise.

4. Run the migration from the api workspace and confirm it applied:
       pnpm --filter @lms/api exec prisma migrate dev --name init_auth_rbac
       pnpm --filter @lms/api exec prisma generate

   If the database is unreachable, STOP and tell me the exact connection error
   and what you need — do not attempt to install or provision a database, and
   do not silently switch to SQLite or an in-memory substitute.

5. Add these scripts to apps/api/package.json:
       "db:migrate"  prisma migrate dev
       "db:generate" prisma generate
       "db:seed"     the seed script below
       "db:studio"   prisma studio

6. Write apps/api/prisma/seed.ts creating one organization, two branches, the
   three roles (Super Admin, Branch Admin, Field Employee) with their
   permissions, and one test user per role with a known password (argon2id
   hashed). Print the credentials at the end so I can log in immediately.
   Make it idempotent — re-running must not duplicate rows.

═══════════════════════════════════════════════════════════════════
PHASE 2 — BACKEND (apps/api)
═══════════════════════════════════════════════════════════════════

Build bottom-up; each layer compiles before the next starts.

2.1  Shared contracts in packages/ first — both api and web consume these, so
     they are written once, here, never duplicated:
       @lms/constants   status enums, permission keys
       @lms/types       request/response DTO types
       @lms/validation  zod schemas encoding the story's Field Rules section

2.2  PrismaModule + PrismaService, injectable app-wide.

2.3  apps/api/src/auth/
       auth.module.ts
       auth.controller.ts     thin — validate, delegate, return
       auth.service.ts        the business rules from the story
       dto/                   typed from @lms/types
       guards/                JwtAuthGuard, PermissionsGuard, ScopeGuard
       auth.service.spec.ts

     Endpoints: POST /auth/login, POST /auth/logout, GET /auth/me
     (plus anything else the story requires).

     Every endpoint enforces, server-side, in this order:
       1. Authenticated?  reject before anything else
       2. Authorized?     the caller's role holds the required permission.
                          Being logged in NEVER implies being permitted.
       3. In scope?       organization and branch filters go IN THE QUERY,
                          never applied in JavaScript after fetch.
                          A missing scope clause is a cross-tenant breach.
       4. State valid?    the current status permits this transition
       5. Audit           every mutation writes actor, org, action, resource,
                          before/after, timestamp

     Passwords: argon2id hashed. Never plaintext, never logged, never in an
     audit record, never in an API response.

═══════════════════════════════════════════════════════════════════
PHASE 3 — FRONTEND (apps/web)
═══════════════════════════════════════════════════════════════════

3.0  Create apps/web/.env.local with NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_APP_URL
     and API_BASE_URL pointing at the NestJS app. Declare any new variable in
     apps/web/src/lib/env.ts (with a matching runtimeEnv entry) and add the name
     to .env.example — so a missing variable fails the build, not production.
     The web app never talks to the database directly; it calls the API.

3.1  apps/web/src/features/auth/
       components/  api/  schemas/  hooks/  types.ts  index.ts
     index.ts is the feature's ONLY public surface — cross-feature deep imports
     are banned by lint. schemas/ re-exports from @lms/validation; never
     redefine a schema there.

3.2  Rewrite SignInForm.tsx into a working form: react-hook-form + zodResolver
     against the @lms/validation schema, controlled inputs with name attributes,
     type="submit" on the button, real error display, loading state.
     WRAP the existing primitives at components/form/input/* — they are
     presentational. Do not replace them.

3.3  Create apps/web/src/middleware.ts gating the (admin) route group.
     Middleware is a redirect layer, NOT an authorization boundary — it does not
     run on every data path. Authorize server-side on every request as well.

3.4  Replace the hardcoded user data in components/header/UserDropdown.tsx and
     components/user-profile/* with real session data.

3.5  Add loading.tsx and error.tsx for the routes you touch.

     Reuse, do not rebuild: @lms/ui (Button, Badge, Alert, Modal, Table),
     components/common/ComponentCard, components/common/PageBreadCrumb,
     @/hooks/useModal, 58 icons at @/icons.

     Accessibility is a gate: real <button> elements, labelled inputs, keyboard
     reachable, WCAG 2.2 AA. The password visibility toggle has a known
     regression in this codebase — do not reintroduce it.

═══════════════════════════════════════════════════════════════════
PHASE 4 — TESTS
═══════════════════════════════════════════════════════════════════

The story's 36 Gherkin scenarios ARE the test plan. Each becomes a test, named
after its scenario so traceability survives:

    it("Scenario 7: Branch Admin reaches the configured failed-login threshold")

Minimum coverage:
  - every Mandatory Field Validation example row
  - every Failure Path scenario (service down, DB unreachable, replay)
  - every Permission Denial scenario
  - every Scope Integrity scenario — explicitly assert Branch A cannot read
    Branch B, and Organization A cannot read Organization B. These are the most
    important tests in the slice; write them even when it feels obvious.
  - every Audit Logging scenario

Plus one Playwright e2e proving the gate is real: signed out → visit / →
redirected to /signin. Without that test, assume the gate is not real.

═══════════════════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════════════════

1.  The story is the spec. Do not add what it does not describe. Do not
    silently drop what it does.
2.  Table and column names come from Database-Schema.md. Status values come
    from State-Machines.md. No improvised names.
3.  Scope belongs in the query, never applied afterwards in JavaScript.
4.  Audit every mutation. Append-only, immutable.
5.  Respect module boundaries. The story names what it does NOT own (user
    administration is Module 3, etc.) — do not build other modules' screens.
6.  app/ holds routes only. Business logic lives in features/.
7.  No secrets in code. Env vars go through src/lib/env.ts, names-only into
    .env.example.
8.  Every value from the DECISIONS block is configurable, not hardcoded.
9.  Match the surrounding code — same naming, layout and comment density as
    what is already there.
10. Keep going. If something is ambiguous, choose the safest interpretation,
    mark it with a TODO, and report it at the end rather than stopping.

═══════════════════════════════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════════════════════════════

Run these and report the ACTUAL output. Never claim green without running:

    pnpm verify      # lint → typecheck → test → build → format:check
    pnpm test:e2e

Then confirm, honestly:
  [ ] Every acceptance criterion implemented, or listed as not-done with reason
  [ ] Every Gherkin scenario has a correspondingly named passing test
  [ ] Scope isolation proven by a test, not by inspection
  [ ] Every mutation writes an audit record
  [ ] No plaintext password stored, logged, or returned
  [ ] I can start the app and log in as each seeded role

Final report:
  1. Files created/modified, grouped by workspace
  2. Packages installed and why
  3. Every decision you made that the spec left open
  4. Exact commands to run the app and the seeded login credentials
  5. What the next story (Forgot-Password) inherits from this

═══════════════════════════════════════════════════════════════════

Start now with Phase 0 and work through to the end.
```

---

## After this one

Same pattern, next story — use [PROMPT-DEVELOPMENT.md](PROMPT-DEVELOPMENT.md), the
reusable per-story version. The foundation this session builds makes every
subsequent slice much smaller.

Order for Module 01: `Sign-In` → `Forgot-Password` → `Reset-Password` →
`Change-Password` → `Active-Sessions-Session-Management` →
`Field-Employee-GPS-Check-in`.
