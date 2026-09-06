# Enterprise Base Guide

How the LMS admin base was assembled from a third-party Next.js dashboard template, and how to repeat that prune against a newer upstream release.

**Working model:** fork in place. Delete what you don't want, add the base essentials, then copy the folder and start building. Phases 1 and 2 are the "copy this and go" boundary. Phase 3 is reference material you consult as the app grows.

---

> ## ✅ Phases 1 and 2 are already applied to this repo
>
> This repo **is** the cleaned base. `lint`, `typecheck`, `build`, 3 unit tests and
> 3 e2e tests all pass; no upstream branding remains. Copy this folder and start
> building — you do not need to re-run Phase 1 or 2.
>
> They are documented below so you know **what was changed and why**, and so you
> can repeat the process against a newer upstream template release.
>
> **One step did not get applied** — the ESLint feature-boundary rule in §2.1.
> A `config-protection` hook blocks edits to `eslint.config.mjs`. Add it by hand
> (the snippet is in §2.1); until you do, the `features/` boundary is a convention
> rather than an enforced rule.
>
> **Before you ship:** all of Phase 3 still applies. Most urgently, there is still
> **no authentication** — every `(admin)` route is publicly reachable.

---

## What you are inheriting

A free Next.js admin dashboard template **v2.3.0** — Next 16.1.6, React 19.2, Tailwind v4, TypeScript strict, App Router.

| Ships working                                   | Is a mockup                                         |
| ----------------------------------------------- | --------------------------------------------------- |
| 20+ UI primitives (`components/ui`)             | Auth forms — no submit handler, uncontrolled inputs |
| Sidebar + header shell, collapsible, responsive | Every dashboard metric, table row, chart series     |
| 58 SVGR icons                                   | Calendar events                                     |
| Tailwind v4 design tokens + dark mode           | User profile / dropdown data                        |
| Form input primitives                           | —                                                   |

**Not present at all:** auth, API routes, database, middleware, tests, `error.tsx`, `loading.tsx`, `.env.example`, CI, security headers, i18n.

Treat this as a **UI kit with a working shell**. Everything behind the UI is yours to build.

---

# Phase 1 — Strip

Goal: a repo that builds clean, with no demo code and no third-party branding.

## 1.1 Project identity

```bash
git init && git add -A && git commit -m "chore: pristine template v2.3.0 baseline"
```

Commit the untouched baseline first. Every later diff then shows exactly what your project changed.

Then:

- `package.json` — rename, reset `version` to `0.1.0`, add `"engines": { "node": ">=20" }` (Next 16 requires Node 20+).
- Add `.nvmrc`.
- Delete `.idea/` and root `banner.png`.
- Delete `.eslintrc.json` — dead legacy config that coexists with `eslint.config.mjs` and confuses tooling.
- Replace `README.md` wholesale — it is entirely upstream marketing.

## 1.2 De-brand

**39 occurrences of the vendor name across 20 files.** Don't find-and-replace them — remove them structurally.

### The leverage move

[src/app/layout.tsx](src/app/layout.tsx) exports **no `metadata` at all**. Every one of the 21 page files repeats the full title string instead.

Add a root metadata export:

```ts
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL!),
  title: { default: "Acme Console", template: "%s | Acme Console" },
  description: "...",
  openGraph: {/* defaults */},
};
```

Then reduce every page to a bare title: `export const metadata = { title: "Calendar" }`. This removes ~39 branded strings in one refactor and gives you the `metadataBase` you need for OG images anyway.

Pages to update follow one pattern; representative paths:

- [src/app/(admin)/page.tsx:11](<src/app/(admin)/page.tsx#L11>)
- [src/app/(admin)/(others-pages)/calendar/page.tsx:7](<src/app/(admin)/(others-pages)/calendar/page.tsx#L7>)
- [src/app/(admin)/(others-pages)/profile/page.tsx:8](<src/app/(admin)/(others-pages)/profile/page.tsx#L8>)
- [src/app/(full-width-pages)/(auth)/signin/page.tsx:5](<src/app/(full-width-pages)/(auth)/signin/page.tsx#L5>)

### The rest of the checklist

- **Delete [src/layout/SidebarWidget.tsx](src/layout/SidebarWidget.tsx)** — an "Upgrade To Pro" ad card linking to the vendor's pricing page. Remove its render site in [src/layout/AppSidebar.tsx](src/layout/AppSidebar.tsx).
- Remove the `pro?: boolean` / `new?: boolean` upsell flags from the nav item type in `AppSidebar.tsx`.
- Replace `public/images/logo/{auth-logo,logo,logo-dark,logo-icon}.svg`, `public/images/favicon.ico`, `src/app/favicon.ico`.
- [src/app/(full-width-pages)/(auth)/layout.tsx](<src/app/(full-width-pages)/(auth)/layout.tsx>) — replace the tagline, **and fix `src="./images/..."` → `/images/...`**. The relative path resolves differently depending on route depth; it works by accident today.
- Footer credits: [src/app/(full-width-pages)/(error-pages)/error-404/page.tsx:50](<src/app/(full-width-pages)/(error-pages)/error-404/page.tsx#L50>) and [src/app/not-found.tsx:43](src/app/not-found.tsx#L43).

Verify when done: a case-insensitive grep for the vendor name across `src/`, `public/` and `README.md` returns nothing.

## 1.3 Delete demo code

### Keep — this is the value you're inheriting

`src/components/ui/*` · `components/form/input` · `form/switch` · `form/group-input` · `components/common/*` · `components/tables/*` · `src/icons/*` · `src/layout/*` · `src/context/*` · `src/hooks/*`

### Delete

| Delete                                                                 | Lets you uninstall                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/components/ecommerce/*` + the `(admin)/page.tsx` body             | `@react-jvectormap/core`, `@react-jvectormap/world`, **and the `overrides` block** |
| `src/components/example/ModalExample/*`                                | —                                                                                  |
| `src/components/videos/*` + `(ui-elements)/videos`                     | —                                                                                  |
| `src/components/form/form-elements/*`                                  | `react-dropzone`                                                                   |
| `src/components/calendar/*` + the `calendar` route                     | 6 × `@fullcalendar/*`                                                              |
| `(ui-elements)` route group (7 routes)                                 | —                                                                                  |
| `(chart)` routes + `components/charts/*`, if you don't need charts yet | `apexcharts`, `react-apexcharts`                                                   |

**Unused already — no code to delete, just uninstall:** `react-dnd`, `react-dnd-html5-backend`, `swiper` (zero imports in `src/`), plus dead `autoprefixer` (unreferenced by `postcss.config.js`) and orphaned `@types/react-transition-group` (no runtime package).

> ⚠️ **Do not uninstall `flatpickr`.** Despite being demo-adjacent, it is used by [src/components/form/date-picker.tsx](src/components/form/date-picker.tsx), which is a keeper. Its global CSS import in `layout.tsx:3` stays too.

> ⚠️ **Removing the `overrides` block is mandatory, not optional.** It force-installs `@react-jvectormap/*` against React 19 peer ranges those packages never declared support for. Carrying a suppressed peer conflict into a long-lived enterprise codebase is this template's worst inheritance — it will block your next React upgrade.

## 1.4 Shrink `globals.css`

[src/app/globals.css](src/app/globals.css) is **752 lines**. Its structure:

| Lines   | Contents                                    | Action                                |
| ------- | ------------------------------------------- | ------------------------------------- |
| 5–177   | `@theme {}` token block                     | **Keep** — this is your design system |
| 178+    | `@layer base`                               | Keep                                  |
| 195–277 | 15 `@utility` blocks — sidebar menu classes | Keep if keeping `AppSidebar`          |
| 284→end | Third-party overrides                       | **Delete per library you dropped**    |

The trailing block breaks down as: ApexCharts (~296–330), flatpickr (~331–493), FullCalendar (~494–641), Swiper (~642–710), jVectorMap (~711–752).

**Applied here:** lines 494–752 were removed (FullCalendar, Swiper, jVectorMap), taking the file from **752 to 493 lines**. The ApexCharts and flatpickr sections stay because both libraries are still in use. Brace balance was verified after the cut.

## 1.5 Fix inherited defects

Real bugs in the base. All of these were fixed in this repo — listed so you know what changed and can spot them again in a newer upstream release.

- **Duplicate ThemeProvider** ✅ _fixed._ `(full-width-pages)/(auth)/layout.tsx` nested a second `<ThemeProvider>` inside the root one, with independent state, so theme toggles on auth pages diverged from the rest of the app. Inner provider removed.
- **Dark-mode flash** ✅ _fixed._ `ThemeContext` read `localStorage` in a `useEffect`, so dark-mode users got a light flash on every first paint. A blocking inline script in the root layout now applies the `dark` class before paint, and `ThemeContext` reads that class as its initial state via a lazy initializer instead of a post-hydration `setState`.
- **Dead `/reset-password` link** ✅ _fixed._ The link at `SignInForm.tsx` pointed at a route that didn't exist. A presentational `/reset-password` page was added — wire it to your provider's reset flow.
- **Inert `@tailwindcss/forms`** ✅ _fixed._ With no `tailwind.config` and no `@plugin` directive it was never loaded. Now wired via `@plugin '@tailwindcss/forms';` in `globals.css`.
- **Prettier broken out of the box** ✅ _fixed._ `prettier.config.js` referenced `prettier-plugin-tailwindcss`, but neither it nor `prettier` was installed. Both added.
- **Password toggles were not accessible** ✅ _fixed._ In both auth forms the visibility toggle was a `<span onClick>` — unreachable by keyboard, invisible to screen readers. Now a real `<button type="button">` with `aria-label` and `aria-pressed`. An e2e test guards against regression.
- **Derived state stored in effects** ✅ _fixed._ `AppSidebar` computed the open submenu from `pathname` inside a `useEffect` + `setState`, causing a cascading render on every navigation (and failing `react-hooks/set-state-in-effect` under React 19's compiler lint). Now derived during render, with the user's manual toggle kept as an explicit override.
- **Auth forms are non-functional markup** ⚠️ _still open, by design._ The `<form>` has no `onSubmit`, inputs are uncontrolled with no `name`, and the submit `<Button>` has no `type="submit"`. This is intentionally left for you — it depends entirely on your auth provider. See §3.1.

---

# Phase 2 — Base

The minimum that makes this a legitimate enterprise starting point.

## 2.1 Folder architecture — feature-first

```
src/
  app/                  routes only — page / layout / loading / error
    (admin)/            authenticated shell (sidebar + header)
    (full-width-pages)/ auth + error pages
  features/<name>/      ALL new business code
    components/  api/  schemas/  hooks/  types.ts  index.ts
  components/ui/        shared primitives (inherited) — no business logic
  layout/ context/ hooks/ icons/    shared shell (inherited)
  lib/                  env, api client, auth, utils
```

**Rules:**

1. `app/` holds routes only. A `page.tsx` imports from `features/` and does little else.
2. Each feature exposes its public API via `features/<name>/index.ts`. **Cross-feature deep imports are forbidden** — enforce it:

```js
// eslint.config.mjs
rules: {
  "no-restricted-imports": ["error", {
    patterns: [{
      group: ["@/features/*/*"],
      message: "Import from the feature's index.ts, not its internals.",
    }],
  }],
}
```

3. A component graduates from `features/` to `components/ui/` only when a **third** feature needs it. Two is a coincidence.
4. New authenticated routes go inside the `(admin)` group to inherit the shell.

**Two gotchas specific to this template:**

- [src/app/(admin)/layout.tsx](<src/app/(admin)/layout.tsx>) is `"use client"` — it consumes `useSidebar()` to compute the content margin. Pages beneath it are still server components and can export `metadata`, but **do not put server-only data fetching in that layout.**
- Nested route groups like `(others-pages)/(chart)` add **no URL segment**. `/bar-chart` is a top-level route. Don't let the folder nesting mislead you about the URL.

## 2.2 Required additions

| Add                | Use                                               | Where                                                                                                                           |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Env validation     | `@t3-oss/env-nextjs` + `zod`                      | `src/lib/env.ts`, imported by `next.config.ts` so a bad env fails the build, not runtime                                        |
| `.env.example`     | —                                                 | Committed. Names only, never values                                                                                             |
| Error / loading UI | —                                                 | `app/error.tsx`, `app/global-error.tsx`, `loading.tsx` per route group — **none exist today**, and the dashboard is chart-heavy |
| Forms              | `react-hook-form` + `zod` + `@hookform/resolvers` | Wrap the inherited `form/input/*` primitives — they're presentational, don't replace them                                       |
| Server state       | TanStack Query, or RSC + server actions           | `features/<name>/api/`                                                                                                          |
| Testing            | Vitest + Testing Library; Playwright for e2e      | No runner exists today                                                                                                          |
| Scripts            | —                                                 | Add `typecheck`, `format`, `test` — only `dev`/`build`/`start`/`lint` exist                                                     |
| Security headers   | —                                                 | `next.config.ts` holds only SVGR config today                                                                                   |
| SEO                | —                                                 | `app/sitemap.ts`, `app/robots.ts`                                                                                               |

**Definition of done for Phase 2** — verified in this repo:

```bash
npm run lint && npm run typecheck && npm run build   # ✅ pass, 13 static routes
npm test                                             # ✅ 3/3 unit tests
npm run test:e2e                                     # ✅ 3/3 e2e tests
grep -ri "<vendor name>" src/ public/                # ✅ no output
```

At that point, copy the folder and start building features.

---

# Phase 3 — Enterprise concerns

Consult as the application grows. Each section is written against _this_ codebase, not in the abstract.

## 3.1 AuthN / AuthZ / RBAC / multi-tenancy

**Starting position: zero auth.** No `src/middleware.ts`, no `src/app/api/`, no session handling, no database, no auth package. **Every `(admin)` route is publicly reachable right now.**

### Choosing AuthN

| Option                  | Pick when                                                                        |
| ----------------------- | -------------------------------------------------------------------------------- |
| Auth.js v5              | You want self-hosted, own the session, have an OIDC/SAML IdP to federate to      |
| Clerk                   | Fastest path to enterprise SSO + SCIM provisioning; accept the vendor dependency |
| Your org's IdP directly | You already run Okta/Entra and have a standard integration pattern               |

### Enforcement is two layers — both required

1. `src/middleware.ts` matched to `(admin)` paths — coarse route gating, redirects unauthenticated users.
2. **Per-request authorization inside every server action and data fetcher.**

> Middleware alone is **not** an authorization boundary. It doesn't run for every data path, and it can't see resource-level context. Treat it as a redirect layer, never as your security model.

### RBAC

Model as roles → permissions → resource checks. Put a `can(user, action, resource)` helper in `src/lib/auth/` and call it server-side. UI hiding is presentation only — never the enforcement point. Wire the sidebar nav visibility in `AppSidebar.tsx` off the same permission set so navigation and authorization can't drift.

### Multi-tenancy

- Decide tenant resolution early: subdomain, path prefix, or JWT claim. Changing it later touches routing, middleware, and every query.
- Propagate tenant context server-side, not through React props.
- **Tenant scoping belongs in the data layer.** A missing `WHERE tenant_id = ?` is a cross-tenant breach; a React component is the wrong place to be responsible for that. Enforce with row-level security or a repository wrapper that cannot issue an unscoped query.

### Concrete rewrites required

- Convert `SignInForm` / `SignUpForm` to controlled inputs or server actions (see 1.5 — they're inert markup).
- Create the missing `/reset-password` route.
- Replace hardcoded user data in `components/header/UserDropdown.tsx` and `components/user-profile/*` with session data.

## 3.2 Compliance, audit, observability

### Audit logging

Record: actor, tenant, action, resource, before/after state, request id, timestamp, source IP.

Emit from a **server-action wrapper**, not from individual handlers — anything a developer has to remember to call will eventually be forgotten. Define retention up front; audit logs typically outlive application data.

### PII handling

Classify fields at the schema level. Then: field-level encryption for sensitive columns, redaction in logs (structured logging makes this enforceable), documented data-subject export and delete paths, and a retention policy per data class.

### Observability

- **Tracing** — OpenTelemetry via Next's `instrumentation.ts`.
- **Logging** — structured, with a correlation id propagated from the edge through every server action.
- **Errors** — Sentry or equivalent, sourcemaps uploaded in CI.
- **RUM** — Core Web Vitals, per-route.
- **SLOs** — defined, with alerting that pages someone.

### SOC 2 / GDPR posture

Map the above to controls: audit logs → CC7; access review → CC6; change management evidence → produced automatically by your CI pipeline (3.3). The cheapest compliance is the kind your pipeline generates as a side effect.

## 3.3 Platform engineering + CI/CD

### Repo strategy

Start single-app. Move to a monorepo (Turborepo) when you have a second consumer of your UI layer — not before. Premature monorepo costs more than it saves.

### CI as required gates

```
install → lint → typecheck → test → build → e2e → a11y → visual regression
```

Nothing merges on red. No exceptions, no "temporary" bypasses.

### Supply chain

- Lockfile committed; CI uses `npm ci`, never `npm install`.
- Dependabot or Renovate, with grouped minor updates.
- SBOM generation on release.
- License scanning with a deny-list.
- **Policy: no `overrides` to suppress peer conflicts.** This template ships exactly that anti-pattern (1.3) — ban it so you don't reintroduce it. A peer conflict is information, not noise.

### Secrets

Never in a committed `.env`. Use the platform secret store. `.env.example` documents **names only**.

### Environments and release

Preview → staging → production. Migrations gated and reversible. Feature flags to decouple deploy from release. Conventional commits + changesets for versioning, tagged releases, and a rollback procedure someone has actually rehearsed.

Add Husky + lint-staged + commitlint locally so CI failures are rare rather than routine.

## 3.4 Design system + a11y governance

### The design system is `globals.css:5-177`

**There is no `tailwind.config`** — Tailwind v4 is CSS-first. All tokens live in the `@theme {}` block:

- Colors: `--color-brand-25` … `--color-brand-950` (brand-500 is `#465fff`)
- Fonts: `--font-outfit`
- Breakpoints: custom scale including `2xsm: 375px`, `xsm: 425px`, `3xl: 2000px`
- Type scale: `--text-title-2xl` … `--text-title-sm`, `--text-theme-xl|sm|xs`

**Rebranding = editing tokens. Component files are never touched.** If a rebrand requires changing a component, that component has hardcoded a value it should have taken from a token — fix it there.

Dark mode is `@custom-variant dark (&:is(.dark *))`, driven by the `dark` class on `documentElement` from `ThemeContext`.

### Governance

Storybook for `components/ui/*`. A contribution checklist every new primitive must satisfy: a11y, dark mode, RTL, all interaction states, tokens-only styling. Visual regression (Chromatic or Playwright snapshots) as a CI gate.

### Accessibility — an enforced gate, not advice

Target WCAG 2.2 AA. Enforce with `eslint-plugin-jsx-a11y` and `axe-core` in Playwright, plus periodic keyboard and screen-reader passes.

> **The inherited code fails this today.** [SignInForm.tsx:104-113](src/components/auth/SignInForm.tsx#L104-L113) — the password visibility toggle is a `<span onClick>` with no `role`, no `tabIndex`, no keyboard handler, and no `aria-label`. It is unreachable by keyboard and invisible to screen readers. This pattern recurs across the UI layer. Audit the whole of `components/ui` before shipping.

### i18n is a day-one decision

`<html lang="en">` is hardcoded in the root layout. Retrofitting i18n and RTL after feature work has started is expensive and touches every component. If there is any chance you'll need it, choose `next-intl` (or equivalent) **before** the first feature ships.

### ADRs

Keep `docs/adr/`. At minimum record: auth provider choice, tenancy model, server-state strategy, and the design-system contract. These are the decisions people will otherwise re-litigate every six months.

---

## Quick checklist

Paste into the first issue of each new project.

**Phase 1 — Strip**

- [ ] `git init` + pristine baseline commit
- [ ] Rename in `package.json`, version `0.1.0`, add `engines` + `.nvmrc`
- [ ] Delete `.idea/`, `banner.png`, `.eslintrc.json`; replace `README.md`
- [ ] Add root `metadata` with `title.template`; reduce all 21 pages to bare titles
- [ ] Delete `SidebarWidget.tsx` + its render site; remove `pro`/`new` nav flags
- [ ] Replace all logo assets and both favicons
- [ ] Fix auth-layout tagline + relative image path
- [ ] Remove footer credits (`error-404:50`, `not-found:43`)
- [ ] Delete demo components per the 1.3 table
- [ ] Uninstall released deps + **remove the `overrides` block** (keep `flatpickr`)
- [ ] Prune the matching `globals.css` override sections
- [ ] Fix: duplicate ThemeProvider, dark-mode flash, `/reset-password`, `@tailwindcss/forms`, Prettier
- [ ] a case-insensitive grep for the vendor name across `src/` and `public/` returns nothing

**Phase 2 — Base**

- [ ] Create `src/features/` + `src/lib/`; add the `no-restricted-imports` rule
- [ ] `src/lib/env.ts` (t3-env + zod), wired into `next.config.ts`; commit `.env.example`
- [ ] Add `error.tsx`, `global-error.tsx`, `loading.tsx`
- [ ] Install react-hook-form + zod; wrap the inherited input primitives
- [ ] Choose server-state approach
- [ ] Vitest + Testing Library + Playwright; one smoke test green
- [ ] Add `typecheck`, `format`, `test` scripts
- [ ] Security headers in `next.config.ts`; `sitemap.ts` + `robots.ts`
- [ ] `lint && typecheck && build` all pass

**Phase 3 — Before production**

- [ ] Auth provider chosen; `middleware.ts` + per-request authorization
- [ ] RBAC `can()` helper; sidebar wired to the same permissions
- [ ] Tenancy model decided and enforced in the data layer
- [ ] Audit logging via server-action wrapper; PII classified
- [ ] OpenTelemetry + structured logging + Sentry + SLOs
- [ ] CI gates green and required; SBOM + license scanning
- [ ] Storybook + visual regression; WCAG 2.2 AA gate passing
- [ ] i18n decision made; ADRs recorded

---

## References

- [Next.js — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js 16 App Router Project Structure — Makerkit](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure)
- [next-colocation-template](https://github.com/arhamkhnz/next-colocation-template)
- [T3 Env — Next.js](https://env.t3.gg/docs/nextjs)
- [next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) — reference for a dashboard base with real data patterns
