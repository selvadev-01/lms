# Admin Base

Next.js 16 admin base — App Router, React 19, Tailwind v4, TypeScript strict.

The web application for the LMS lending platform. See
[TEMPLATE-GUIDE.md](TEMPLATE-GUIDE.md) for how the base was assembled and what
to build next.

## Getting started

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

**Starting a new project on this base?** Follow
[docs/NEW-PROJECT.md](docs/NEW-PROJECT.md) — clone → rebrand → auth → first
feature, with the gotchas called out.

## Scripts

| Script                | Purpose                             |
| --------------------- | ----------------------------------- |
| `npm run dev`         | Dev server                          |
| `npm run verify`      | **All gates except e2e** — use this |
| `npm run verify:full` | Everything, including Playwright    |
| `npm run build`       | Production build (validates env)    |
| `npm run lint`        | ESLint                              |
| `npm run typecheck`   | `tsc --noEmit`                      |
| `npm run format`      | Prettier                            |
| `npm test`            | Vitest unit tests                   |
| `npm run test:e2e`    | Playwright e2e                      |

## Structure

```
src/
  app/            routes only — page / layout / loading / error
    (admin)/      authenticated shell (sidebar + header)
    (full-width-pages)/  auth + error pages
  features/       ALL business code, one folder per feature
  components/ui/  shared primitives — no business logic
  layout/ context/ hooks/ icons/   shared shell
  lib/            env, utils
```

New business code goes in `src/features/<name>/` and is exported through its
`index.ts`. See [src/features/README.md](src/features/README.md).

## What is not built yet

This base has **no authentication** — every `(admin)` route is publicly
reachable. Before production you need at minimum: an auth provider plus
`src/middleware.ts`, per-request authorization in data fetchers, an error
reporter, and CI gates. TEMPLATE-GUIDE.md §3 covers each.

## Theming

All design tokens are in the `@theme {}` block at the top of
`src/app/globals.css` — there is no `tailwind.config`. Rebranding means editing
`--color-brand-*` and `--font-outfit`, not component files.
