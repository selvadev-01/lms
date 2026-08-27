# LMS Folder Structure

## Purpose

This document describes the **actual** folder structure of the LMS monorepo and
the rules for placing new code in it. It is descriptive, not aspirational — the
trees below match what is on disk, and any divergence is a bug in this document
or in the code, not an acceptable difference.

Stack: Next.js (App Router) · NestJS · Prisma · PostgreSQL · pnpm workspaces.

**Last verified:** 2026-08-22, after the `apps/api/src` restructure
(Modules 01–10 complete).

---

## Architecture principles

- **Feature-based frontend** — organized by what the user does, not by file type.
- **Modular monolith backend** — one deployable, hard module boundaries inside.
- **Domain folders live directly under `src/`** — there is deliberately no
  `src/modules/` wrapper. See [Why no `modules/` wrapper](#why-no-modules-wrapper).
- **Business logic stays inside domain modules.** Infrastructure stays in `common/`.
- **Cross-app code lives in `packages/`,** never duplicated per app.
- **A folder tracks a domain, not a user story.** Module numbers are documentation
  concepts; they must not appear in folder names.

---

## Root structure

```text
lms/
├── apps/
│   ├── web/          Next.js App Router frontend
│   └── api/          NestJS backend
├── packages/
│   ├── ui/           Shared UI components
│   ├── api-client/   Shared HTTP client / SDK
│   ├── config/       Shared configuration
│   ├── constants/    Common constants
│   ├── emi/          EMI maths and civil-date utilities
│   ├── types/        Shared TypeScript types
│   ├── utils/        Shared utility functions
│   └── validation/   Shared Zod schemas
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Backend — `apps/api/src`

Domain folders sit directly under `src/`. Infrastructure is separated by being
in `common/`, `config/`, and `prisma/`, not by nesting domains one level deeper.

```text
apps/api/src/
│
├── main.ts / app.module.ts / app.controller.ts / app.service.ts
│
├── common/                       Cross-cutting infrastructure ONLY
│   ├── authorization/            AuthorizationService — live permission checks
│   ├── decorators/               @CurrentUser, @Public, @RequirePermissions
│   ├── filters/                  all-exceptions.filter.ts
│   ├── guards/                   jwt-auth.guard.ts, permissions.guard.ts
│   ├── middleware/               request-id.middleware.ts
│   ├── transforms/               trim.ts — shared DTO transforms
│   └── auth-context.ts
│
├── config/                       Typed config + env validation
├── prisma/                       PrismaModule / PrismaService (@Global)
├── audit/                        AuditService (@Global)
├── sms/                          Provider-abstracted: console + twilio
│
├── auth/                         Module 01 — auth, sessions, recovery
│   └── dto/
│
├── users/                        Modules 02–03
│   ├── users.module.ts           ONE module for both sub-folders
│   ├── user/                     Users + employees
│   │   └── dto/
│   └── rbac/                     Roles, permissions, permission-catalog.ts
│       └── dto/
│
├── organizations/                Module 02 — organizations + branches
│   └── dto/
│
├── master-data/                  Module 06 — master data values
│   └── dto/
│
├── field/                        GPS check-ins, verification
│   └── dto/
│
├── customers/                    Modules 04–05
│   ├── customers.module.ts       ONE module for both aggregates — see note
│   ├── customer/                 Customers, their KYC, their documents
│   │   └── dto/
│   ├── guarantor/                Guarantors, their KYC, their documents
│   │   └── dto/
│   ├── shared/dto/               record-consent.dto.ts — used by both
│   └── storage/                  FILE_STORAGE token, LocalFileStorage, MIME sniffing
│
└── loans/                        Modules 06–10
    ├── loans.module.ts           ONE module wiring all five sub-contexts
    ├── products/                 Loan products + schemes (config)
    │   └── dto/
    ├── applications/             Application lifecycle, documents, transitions
    │   └── dto/
    ├── approval/                 Credit assessment, review, sanction
    ├── disbursal/                Disbursement + 3-account ledger
    │   └── dto/
    ├── repayment/                Repayment schedules, CSV/PDF export
    │   └── dto/
    └── shared/                   loan.service.ts — cross-context within loans
```

### Why sub-folders but not sub-modules

`customers/` and `users/` each contain sub-folders but expose **one** NestJS
module. The sub-folders exist to keep file listings navigable; they are not
module boundaries, and splitting them into separate `@Module`s would be wrong:

- **`customers/customer` + `customers/guarantor`** — a guarantor is only ever
  reachable through a customer. Every guarantor service injects `CustomerService`,
  and all of them share `FILE_STORAGE`, MIME sniffing, and `record-consent.dto`.
  A separate `GuarantorsModule` would need `CustomerService` injected throughout,
  which is the shape of something that already belongs in one module. Both
  aggregates also share one scope rule; two copies of `findInScope` could drift,
  which Module 05 Rules 6–9 and 36 exist to prevent.
- **`users/user` + `users/rbac`** — role assignment and user lifecycle are one
  administrative surface, and `UsersModule` exports services both halves need.

`loans/` follows the same pattern: five sub-folders, one `LoansModule`.

### Why no `modules/` wrapper

An earlier draft of this document proposed `src/modules/<domain>/`. The code
never adopted it, and it was formally rejected on 2026-08-22:

- Domain vs infrastructure is already legible — `common/`, `config/`, `prisma/`
  are obviously not domains.
- The wrapper adds a path segment to every import in the codebase and buys no
  enforcement the current layout lacks.

Do not reintroduce it.

---

## Where new backend code goes

| You are adding                                | Put it in                                         |
| --------------------------------------------- | ------------------------------------------------- |
| A new business domain                         | `src/<domain>/` with its own `<domain>.module.ts` |
| A concern inside an existing domain           | a sub-folder, reusing the domain's module         |
| A guard, filter, pipe, decorator, interceptor | `src/common/<kind>/`                              |
| A DTO transform used by more than one domain  | `src/common/transforms/`                          |
| A DTO                                         | the `dto/` folder nearest its controller          |
| Config or env validation                      | `src/config/`                                     |
| Something two apps need                       | `packages/` — never duplicate across apps         |

### Rules

**Do**

- Co-locate tests: `x.service.ts` next to `x.service.spec.ts`.
- Name files `<thing>.<role>.ts` — `.controller`, `.service`, `.module`,
  `.mapper`, `.dto`, `.spec`.
- Keep `common/` small. It is currently 14 files; treat growth as a smell.
- Export a service from its module when another module must reuse its rules
  rather than re-derive them.

**Don't**

- Put loan or customer business logic in `common/`.
- Create a `shared/` or `utils/` dump inside a domain. `loans/shared/` and
  `customers/shared/` are narrow, named exceptions for genuinely cross-context
  code within one domain.
- Name a folder after a user-story number.
- Reach into another domain's internals — import its exported service.

### Watch: files past a sane size

These carry more than one responsibility and are candidates for splitting.
Splitting them involves real code changes and is deliberately **not** part of
the folder restructure:

| File                                             | Lines |
| ------------------------------------------------ | ----- |
| `loans/disbursal/disbursement.service.ts`        | 1612  |
| `users/user/user.service.ts`                     | 1188  |
| `loans/repayment/repayment-schedule.service.ts`  | 961   |
| `customers/guarantor/guarantor.service.ts`       | 916   |
| `loans/applications/loan-application.service.ts` | 913   |

For `disbursement.service.ts`, the natural seams are orchestration, the two
state machines, and the pre-disbursal gates.

---

## Frontend — `apps/web/src`

```text
apps/web/
└── src/
    ├── app/                  App Router routes
    ├── features/             One folder per feature
    │   ├── auth/  dashboard/  customers/  loans/
    │   ├── collections/  accounting/  reports/  settings/
    ├── components/           Web-only shared components
    ├── hooks/                Web-only hooks
    ├── lib/                  Web-only helpers
    ├── styles/
    └── middleware.ts
```

A feature folder:

```text
features/customers/
├── api/          Server calls / query hooks
├── actions/      Server actions
├── components/   Feature-scoped UI
├── hooks/
├── schemas/      Feature-local Zod (shared rules go to packages/validation)
├── types/
├── utils/
└── index.ts      Public surface — import features through this
```

Use `components/`, `hooks/`, `lib/`, `styles/` for **web-only** code. Anything
another app could want belongs in `packages/`.

> **Validation caveat.** A rule written only in `packages/validation` is enforced
> on the web client only. The API validates independently — every conditional
> rule that matters must exist in the API DTO too.

---

## Shared packages

| Package      | Purpose                         |
| ------------ | ------------------------------- |
| `ui`         | Shared UI components            |
| `api-client` | Shared HTTP client and SDK      |
| `config`     | Shared configuration            |
| `constants`  | Common constants                |
| `emi`        | EMI maths, civil-date utilities |
| `types`      | Shared TypeScript types         |
| `utils`      | Shared utility functions        |
| `validation` | Shared Zod schemas              |

---

## Gotchas

- **Path literals don't move themselves.** Import specifiers can be rewritten
  mechanically, but `join(__dirname, '..', '..')` cannot. After any file move,
  grep for `__dirname` and check depth — this broke
  `user-dependencies.spec.ts` during the 2026-08-22 restructure.
- **Prettier and deeper imports.** Adding a `../` can push an import past the
  print width. Run `eslint --fix` after a restructure; 88 of 91 errors were
  purely this.
- **Always use `pnpm db:generate`,** never bare `npx prisma generate` — the
  bare command skips the CJS patch and breaks every Jest suite.
- **`src/generated/`** is gitignored and lint-ignored. Never edit it, never
  commit it.
- **The BOM in `repayment-schedule-export.ts`** is deliberate, so Excel reads
  the CSV as UTF-8. The `no-irregular-whitespace` error there is a false positive.

---

## Verification

After any structural change, all four must pass:

```bash
cd apps/api
npx tsc --noEmit -p tsconfig.json        # 0 errors
npx tsc --noEmit -p tsconfig.spec.json   # 0 errors
pnpm build
NODE_OPTIONS=--max-old-space-size=6144 npx jest --runInBand
```

`--runInBand` matters: the full suite OOMs under default parallelism on a
typical dev machine.

Baseline as of 2026-08-22: **49 suites, 1119 tests, all passing.** Lint is clean
except the 3 documented false positives above.
