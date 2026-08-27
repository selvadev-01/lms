# New Project Setup

Step-by-step guide for starting an application on this base.

**Time to a running, rebranded app: ~30 minutes.** Auth is the first real work
after that, and it comes before feature code — not after.

> Read [TEMPLATE-GUIDE.md](TEMPLATE-GUIDE.md) if you want to know _why_ the
> base is shaped this way. This document is the _how_.

---

## Step 0 — Prerequisites

- **Node 20+** (`.nvmrc` pins it — `nvm use` if you have nvm)
- npm (the repo ships `package-lock.json`; don't switch package managers casually)
- Git

---

## Step 1 — Copy the base

Copy the base folder to your new project location. On Windows:

```powershell
robocopy <base-path> c:\projects\my-app /E /XD node_modules .next test-results playwright-report
cd c:\projects\my-app
```

Or on macOS/Linux:

```bash
rsync -a --exclude node_modules --exclude .next <base-path>/ my-app/
cd my-app
```

Then:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. You should see the dashboard placeholder with a
working sidebar, header, and dark-mode toggle.

> **Keep an untouched copy of the base somewhere separate.** Every later
> comparison — "did I break this or did it ship broken?" — depends on having the
> original to diff against. If you use version control, commit the copied base
> before changing anything and the same benefit comes for free.

---

## Step 2 — Rebrand (~15 min)

Edit **only** these four things. If a rebrand makes you touch a component file,
that component hardcoded a value it should have read from a token — fix it there
instead.

### 2.1 Identity

`package.json` — set `name`, keep `version` at `0.1.0`.

### 2.2 Name and URL

`.env.local`:

```bash
NEXT_PUBLIC_APP_NAME="Acme Console"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

These flow into page titles, OG tags, `sitemap.xml` and `robots.txt`
automatically — the root layout builds `title.template` from
`NEXT_PUBLIC_APP_NAME`, so every page title updates at once. Nothing else to edit.

### 2.3 Colors and font

All design tokens live in the `@theme {}` block at the top of
`src/app/globals.css`. **There is no `tailwind.config`** — Tailwind v4 is
CSS-first.

```css
@theme {
  --font-outfit: Outfit, sans-serif; /* line 8 */

  --color-brand-25: #f2f7ff; /* line 42 — lightest */
  --color-brand-500: #465fff; /* line 48 — your primary */
  --color-brand-950: #161950; /* line 53 — darkest */
  /* ...the full 25–950 ramp sits between */
}
```

Replace the `--color-brand-*` ramp with your palette and swap `--font-outfit`
(also update the `next/font/google` import in `src/app/layout.tsx` if you change
the family). Every component picks it up.

### 2.4 Logos and favicons

Replace in place, keeping the filenames:

- `public/images/logo/logo.svg` — sidebar, light mode
- `public/images/logo/logo-dark.svg` — sidebar, dark mode
- `public/images/logo/logo-icon.svg` — collapsed sidebar (square)
- `public/images/logo/auth-logo.svg` — sign-in page
- `src/app/favicon.ico`

### 2.5 Verify

```bash
npm run build
```

Commit: `git commit -am "feat: rebrand to Acme Console"`

---

## Step 3 — Set up auth ⚠️ **do this before feature work**

> **Every `(admin)` route is publicly reachable right now.** There is no
> authentication in this base at all — no middleware, no session, no database.
> The forms at `/signin` and `/signup` are inert markup.

This comes first because the route structure and data-fetching patterns you
build later all assume an authenticated caller. Retrofitting is far worse than
starting with it.

### 3.1 Choose a provider

| Option             | Choose when                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| **Auth.js v5**     | Self-hosted, you want to own the session, federating to an OIDC/SAML IdP |
| **Clerk**          | Fastest path to enterprise SSO + SCIM; accept the vendor dependency      |
| **Your org's IdP** | You already run Okta/Entra with a standard integration                   |

### 3.2 Add the secrets to the env schema

Never read `process.env` directly. Add to `src/lib/env.ts` under `server`:

```ts
server: {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url(),
},
runtimeEnv: {
  NODE_ENV: process.env.NODE_ENV,
  AUTH_SECRET: process.env.AUTH_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  // ...existing NEXT_PUBLIC_* entries
},
```

Add the same keys (names only, no values) to `.env.example`, and real values to
`.env.local`. A missing or malformed variable now fails `npm run build` instead
of surfacing in production.

### 3.3 Gate the routes

Create `src/middleware.ts`:

```ts
export { auth as middleware } from "@/lib/auth";

export const config = {
  // Everything except Next internals, static assets, and the auth pages.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|images|signin|signup|reset-password).*)",
  ],
};
```

### 3.4 Authorize every data path

> **Middleware is not an authorization boundary.** It gates navigation, but it
> does not run on every data path and cannot see resource-level context.

Add `src/lib/auth/can.ts` and call it server-side in **every** server action and
data fetcher:

```ts
export async function can(user: User, action: Action, resource: Resource) {
  /* ... */
}
```

Hiding a button in the UI is presentation, never enforcement.

### 3.5 Wire up the forms

Four concrete edits:

| File                                                                      | Change                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/components/auth/SignInForm.tsx`                                      | Add `onSubmit`/server action; give inputs `name` + controlled values; `type="submit"` on the button |
| `src/components/auth/SignUpForm.tsx`                                      | Same                                                                                                |
| `src/app/(full-width-pages)/(auth)/reset-password/page.tsx`               | Wire to the provider's reset flow                                                                   |
| `src/components/header/UserDropdown.tsx`, `src/components/user-profile/*` | Replace hardcoded user data with session data                                                       |

Use `react-hook-form` + `zod` (both already installed) and wrap the existing
`src/components/form/input/*` primitives — they're presentational, so wrap rather
than replace.

### 3.6 Prove it

Add an e2e test asserting a signed-out visit to `/` redirects to `/signin`. If
that test doesn't exist, assume the gate isn't real.

---

## Step 4 — Decide on i18n

**Decide now, even if the answer is "English only".** `<html lang="en">` is
hardcoded in `src/app/layout.tsx`, and retrofitting i18n + RTL after thirty
components exist is expensive. If there's any chance you'll need it, install
`next-intl` before the first feature ships.

---

## Step 5 — Build the first feature

This proves the architecture end to end. Structure:

```
src/features/billing/
  components/InvoiceTable.tsx
  api/queries.ts
  schemas/invoice.ts
  types.ts
  index.ts          ← the ONLY public surface
```

`index.ts`:

```ts
export { InvoiceTable } from "./components/InvoiceTable";
export { getInvoices } from "./api/queries";
export type { Invoice } from "./types";
```

Route — imports from the feature and does little else:

```tsx
// src/app/(admin)/billing/page.tsx
import { InvoiceTable, getInvoices } from "@/features/billing";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const invoices = await getInvoices(); // authorize inside getInvoices
  return <InvoiceTable invoices={invoices} />;
}
```

Add the nav entry in `src/layout/AppSidebar.tsx` (`navItems`), gated on the
caller's permissions.

### The rules

1. **Export through `index.ts`.** Deep imports across features are banned.
2. **Features never import each other's internals.** Shared code goes to
   `@/lib` or `@/components/ui`.
3. **Promote on the third use.** A component moves to `components/ui/` when a
   third feature needs it — two is a coincidence.
4. **`app/` holds routes only.**
5. **Authorize in the data layer**, not the component.

### Reusing what's already there

Don't rebuild these — they ship with the base:

| Need                                                | Use                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Card wrapper                                        | `@/components/common/ComponentCard` (`title`, `desc`, `className`) |
| Status pill                                         | `@/components/ui/badge/Badge` (`color`, `variant`, `size`)         |
| Buttons, modals, tables, avatars, alerts, dropdowns | `@/components/ui/*`                                                |
| Form inputs                                         | `@/components/form/input/*`, `form/switch`, `form/group-input`     |
| Breadcrumb                                          | `@/components/common/PageBreadCrumb`                               |
| Charts                                              | `@/components/charts/*` (ApexCharts)                               |
| Icons (58)                                          | `import { GridIcon } from "@/icons"`                               |
| Modal open/close                                    | `@/hooks/useModal`                                                 |

---

## Step 6 — Before production

Non-negotiable:

- [ ] Auth + per-request authorization (Step 3) — **the big one**
- [ ] Error reporter wired into `src/app/error.tsx` (currently `console.error`)
- [ ] CSP added to `next.config.ts` — baseline headers ship, CSP does not
      (the theme-init script in the root layout needs a nonce or hash)
- [ ] Secrets in the platform secret store, never a committed `.env`
- [ ] One e2e test per critical user path
- [ ] CI gates required on the default branch
- [ ] `npm audit` clean at high severity

Then work through [TEMPLATE-GUIDE.md](TEMPLATE-GUIDE.md) §3 as the app grows:
RBAC, multi-tenancy, audit logging, observability, a11y gate, design-system
governance.

---

## Daily commands

| Command               | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `npm run dev`         | Dev server                                          |
| `npm run verify`      | **All gates except e2e** — run this before shipping |
| `npm run verify:full` | Everything, including Playwright                    |
| `npm run lint`        | ESLint                                              |
| `npm run typecheck`   | `tsc --noEmit`                                      |
| `npm run format`      | Prettier (write)                                    |
| `npm test`            | Vitest unit tests                                   |
| `npm run test:e2e`    | Playwright                                          |
| `npm run build`       | Production build — also validates env               |

**Before shipping any change: `npm run verify`.** It runs lint → typecheck →
format → unit tests → build in sequence and stops at the first failure — the same
sequence CI runs, so a green `verify` means a green pipeline.

---

## Troubleshooting

**Build fails with an env error.** A variable in `src/lib/env.ts` is missing from
`.env.local`. That's the mechanism working — add it. `SKIP_ENV_VALIDATION=true`
exists for Docker builds, not for silencing the error locally.

**`npm run format:check` fails in CI.** Run `npm run format` and commit.

**Dark mode flashes on load.** The blocking script in `src/app/layout.tsx` was
removed or the `dark` class handling changed. Both must stay in sync with
`ThemeContext`.

**A style change doesn't apply.** You probably edited a component. Design changes
belong in the `@theme {}` block in `globals.css`.

**ESLint: "Calling setState synchronously within an effect".** You're storing
derived state. Compute it during render instead — see `AppSidebar.tsx` for the
pattern.

**Import blocked by `no-restricted-imports`.** You reached into a feature's
internals. Export it from that feature's `index.ts`, or move it to `@/lib`.
