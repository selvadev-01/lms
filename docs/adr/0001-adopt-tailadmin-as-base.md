# 1. Adopt the TailAdmin free template as our application base

**Status:** Accepted
**Date:** 2026-08-12

## Context

We needed a common starting point for multiple enterprise Next.js applications
rather than scaffolding each one from `create-next-app` and rebuilding the same
admin shell every time.

TailAdmin's free Next.js template (v2.3.0 — Next 16.1.6, React 19.2, Tailwind v4,
TypeScript strict, App Router) provided a working sidebar/header shell, ~20 UI
primitives, 58 icons, and a coherent Tailwind v4 token system. What it did not
provide: authentication, a data layer, tests, error boundaries, environment
validation, or CI.

## Decision

Fork the template **in place**, strip it to its reusable core, and add the
baseline an enterprise project needs. The result is this repository, used as the
seed for new projects.

Specifically:

- **Deleted** all demo code — ecommerce dashboard, calendar, modal examples,
  video pages, form-element showcase, and the `(ui-elements)` route group —
  along with 12 dependencies they were the only consumers of.
- **Removed the `overrides` block** that force-installed `@react-jvectormap/*`
  against React 19 peer ranges. CI now fails if an `overrides` block reappears.
- **Adopted feature-first architecture**: business code in `src/features/<name>/`
  behind an `index.ts` public API; `app/` holds routes only.
- **Added**: env validation (t3-env + Zod, build-time), error/loading boundaries,
  security headers, Vitest + Playwright, and CI gates.

## Consequences

**Positive.** New projects start with a working shell, a design-token system, and
green quality gates on day one. The deletions are documented in TEMPLATE-GUIDE.md,
so the same prune can be repeated against a newer upstream release.

**Negative.** We inherit a codebase we did not write. Upstream fixes no longer
flow to us — we are the maintainer now. The pristine v2.3.0 template is kept at
`c:\projects\tailadmin-v2.3.0-pristine` for diffing against future releases.

**Deferred.** Authentication is deliberately not chosen here — it varies per
project. Every `(admin)` route is publicly reachable until a project adds
middleware and per-request authorization. This is the single most important gap
to close before any deployment; see TEMPLATE-GUIDE.md §3.1.

## Alternatives considered

- **Harvest into a fresh `create-next-app`.** Cleaner history and no inherited
  liabilities, but slower to reach a working shell and easy to omit pieces
  (the `@utility` sidebar classes in `globals.css` are load-bearing and easy to
  miss). Rejected as higher effort for marginal gain once the `overrides` block
  was removed anyway.
- **Publish the UI layer as a private `@org/ui` package.** Highest ceiling for
  reuse across many apps, but significant upfront cost (registry, versioning,
  release process) before the first application ships. Revisit once three or more
  projects are running on this base.
