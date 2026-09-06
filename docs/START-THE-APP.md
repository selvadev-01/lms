# Start the app locally

The `README.md` "Getting started" section is stale — it predates the API and omits the database, migration, and seed steps. Use this instead.

## Prerequisites

- **Node 20** (see `.nvmrc`)
- **pnpm 10.20.0** (`packageManager` in the root `package.json`)
- **A running PostgreSQL** with an empty database named `lms_dev`.
  There is no `docker-compose.yml` in this repo — Postgres is not started for you.

```bash
createdb lms_dev            # or: psql -c "CREATE DATABASE lms_dev;"
```

## First-time setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

Then edit `apps/api/.env`:

```
DATABASE_URL="postgresql://postgres:<your-password>@localhost:5432/lms_dev?schema=public"
AUTH_JWT_SECRET="<at least 32 characters>"
WEB_ORIGIN="http://localhost:3000"
```

`AUTH_JWT_SECRET` has no default. The API refuses to boot without it.

## Database

```bash
pnpm --filter @lms/api db:generate
pnpm --filter @lms/api db:migrate:deploy
pnpm --filter @lms/api db:seed
```

> Always use `db:generate`, never a bare `npx prisma generate` — the script runs a
> required CJS patch step afterwards (`scripts/patch-prisma-client.mjs`). Skipping it
> breaks every Jest suite with an `import.meta` error.

The seed is idempotent, so it is safe to re-run.

## Run

```bash
pnpm dev
```

Turbo starts both apps:

| App              | URL                                           |
| ---------------- | --------------------------------------------- |
| Web (Next.js 16) | http://localhost:3000                         |
| API (NestJS)     | http://localhost:3001, routes under `/api/v1` |

To run one only: `pnpm --filter @lms/web dev` / `pnpm --filter @lms/api dev`.

## Sign in

Sign-in is **Organization Code + Mobile Number + Password**. There are no email logins.

Seeded organization: **`DEMO`**. Shared password for every seeded account: **`Kestrel7Vault`**.

| Role           | Org code | Mobile       | Scope                                                                                                                                          |
| -------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Super Admin    | `DEMO`   | `9000000001` | Organization-wide. Holds every permission except `field.checkin`, `recovery.writeoff.post`, and `retention.purge.run` (deliberately withheld). |
| Branch Admin   | `DEMO`   | `9000000002` | Branch `BR001` only. Reads most surfaces; most mutations are refused.                                                                          |
| Field Employee | `DEMO`   | `9000000004` | Branch `BR001`. Collections, cash handovers, GPS check-in.                                                                                     |

Other seeded fixtures (`9000000005`–`9000000022`) exist for the e2e suite and include
deliberately `INACTIVE`, `LOCKED`, and `PENDING` accounts. A second organization,
`OTHERORG`, exists to test tenant isolation.

Seeded data also includes branches `BR001` (Chennai Main) and `BR002`, customers
`CUST001`–`CUST008`, loan schemes, the chart of accounts, and notification templates.

## Rate limits

The API throttles globally at **60 requests/minute**, with the dashboard controller
raised to 240/min. Rapid navigation can produce `429` responses that look like broken
pages. `apps/api/.env` already raises `AUTH_SIGN_IN_RATE_LIMIT` to 500 for the e2e
suite — leave that as-is.

## Tests

```bash
pnpm verify            # lint + typecheck + test + build + format check
pnpm test:e2e          # Playwright, requires the app to be running
```

Playwright config: `apps/web/playwright.config.ts`. Base URL `http://localhost:3000`,
overridable with `PLAYWRIGHT_BASE_URL`.

### When the suite starts failing at sign-in

`change-password.spec.ts` and `recovery.spec.ts` rotate real account passwords
and consume their fixtures. An interrupted run — or simply running one of them
twice — leaves the account on a password nobody knows, and `db:seed` cannot
repair it (it is idempotent, and a history depth of 5 means the seed password
would be refused as reuse anyway).

The symptom is a whole `describe.serial` block failing at its shared sign-in,
naming a _different_ test each run. Confirm it in seconds — a 401 for the
mutated mobile beside a 200 for the never-mutated control:

```bash
# expect 401 (broken) then 200 (control)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3001/api/v1/auth/sign-in \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -H 'X-LMS-Request: 1' \
  -d '{"mobile":"9000000007","password":"Kestrel7Vault","orgCode":"DEMO"}'
```

Then repair and refresh the saved sessions:

```bash
pnpm --filter @lms/api db:reset-password-fixtures
pnpm --filter @lms/web exec playwright test --project=setup
```

This is fixture state, not a regression in whatever you last changed.
