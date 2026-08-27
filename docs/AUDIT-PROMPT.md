# Full-application audit prompt (Claude Chrome extension)

Start the app first — see [START-THE-APP.md](START-THE-APP.md). Then paste everything
below the line into the Claude Chrome extension.

---

You are auditing a Loan Management System running locally at **http://localhost:3000**
(API at http://localhost:3001, routes under `/api/v1`). The app is already running.

Your job is to drive the app in the browser as a real user, find functional defects,
and produce a prioritized UI/UX upgrade report. **Do not edit any code.** Observe,
interact, screenshot, and report.

## Credentials

Sign-in is **Organization Code + Mobile Number + Password**. There are no email logins.
Every account below uses the password `Kestrel7Vault` and organization code `DEMO`.

| Use as | Mobile | What this role can do |
|---|---|---|
| **Super Admin** | `9000000001` | Organization-wide. Every permission except `field.checkin`, `recovery.writeoff.post`, `retention.purge.run` — these are withheld on purpose, so being refused there is correct behavior, not a bug. |
| **Branch Admin** | `9000000002` | Branch `BR001` only. Reads most screens; most mutations are refused by design. |
| **Field Employee** | `9000000004` | Branch `BR001`. Collections, cash handovers, GPS check-in. |

Do the main sweep as Super Admin. Then re-check a sample of screens as Branch Admin and
Field Employee to test permission scoping.

## Ground rules

1. **Do not delete or rename seeded fixtures.** Customers `CUST001`–`CUST008`, users
   `9000000005`–`9000000022`, branches `BR001`/`BR002`, and the seeded roles are used by
   the automated test suite. Deleting them breaks it. Create new records to test
   create/edit/delete flows.
2. **Pace yourself.** The API throttles at 60 requests/minute globally. If you get a
   `429` or a screen suddenly shows errors after rapid clicking, wait ~60 seconds and
   retry before recording anything. Throttling is not a defect — do not report it.
3. **Screenshot every defect** and reference the screenshot in your findings.
4. **Open DevTools** and watch the console and network tabs. Record the exact failing
   request (method, URL, status, response body) for any error.
5. **Report as you go.** Do not batch all findings until the end — surface each one as
   you find it, then continue.

## Part 1 — Walk every screen

Visit each route, confirm it loads, and note anything broken. Grouped for role-by-role
work:

**Auth** — `/signin`, `/signup`, `/forgot-password`, `/forgot-password/verify`,
`/reset-password`, `/change-password`

**Core** — `/`, `/dashboard`, `/profile`, `/active-sessions`, `/branch`

**Organization** — `/branches`, `/branches/new`, `/branches/[id]`, `/company-settings`,
`/settings/master-data`

**Access** — `/users`, `/employees`, `/roles` (and `/new` + `/[id]` for each)

**Customers** — `/customers`, `/customers/new`, `/customers/[id]`, `/guarantors`,
`/guarantors/[id]`

**Loans** — `/loans/applications` (+`/new`, `/[id]`), `/loans/disbursements` (+`/new`,
`/[id]`), `/loans/collections` (+`/new`, `/[id]`), `/loans/products`, `/loans/schemes`

**Field** — `/field`, `/field/check-in`, `/field/collections` (+`/[id]`),
`/field/cash-handovers` (+`/new`, `/[id]`), `/field/cash-reconciliation` (+`/new`,
`/[id]`), `/field/offline`, `/field/sync-queue`

**Finance** — `/finance/accounts` (+`/new`, `/[id]`), `/finance/journals` (+`/new`,
`/[id]`, `/[id]/edit`), `/finance/ledger`, `/finance/trial-balance`,
`/finance/reconciliation`

**Recovery** — `/overdues`, `/overdues/[loanId]`, `/recovery-cases`,
`/recovery-cases/[id]`, `/recovery-actions/[id]`

**Reports** — `/reports/dashboard`, `/reports/portfolio`, `/reports/applications`,
`/reports/disbursals`, `/reports/collections`, `/reports/field-collections`,
`/reports/financial`, `/reports/overdue-recovery`, `/reports/saved`

**Notifications** — `/notifications`, `/notifications/[id]`, `/notifications/preferences`,
`/admin/notifications/templates`, `/admin/notifications/rules`,
`/admin/notifications/deliveries`

**Admin** — `/admin/audit`, `/admin/audit/[id]`, `/admin/maintenance/jobs`,
`/admin/settings/organization`, `/admin/settings/branch`, `/admin/settings/operational`,
`/admin/settings/retention`, `/admin/settings/changes`, `/admin/settings/transfer`

**Known leftovers — do not audit, just confirm they are still reachable and flag them for
deletion:** `/basic-tables`, `/blank`, `/error-404`, `/line-chart`, `/bar-chart`, and the
sidebar's "Others → Authentication" group linking to `/signin` and `/signup`. These are
unremoved demo pages from the UI template and should not be in a production sidebar.

## Part 2 — Complete these six journeys end to end

Page-load checks miss most real defects. Actually finish each flow:

1. **Dashboard integrity.** Sign in as Super Admin. For every dashboard widget, click its
   drill-down link and confirm it lands on a real screen showing data consistent with the
   widget's number. Note any widget that shows zero where data plainly exists, or whose
   link 404s.
2. **Customer onboarding.** Create a new customer → complete KYC → create a guarantor →
   link the guarantor to that customer. Note anything that silently fails or accepts
   invalid input.
3. **Loan lifecycle.** Create a loan application through the multi-step wizard → submit →
   approve it as Super Admin → disburse it → open the resulting repayment schedule.
   This is the longest flow and the most likely to break.
4. **Collection to ledger.** Record an EMI collection against the loan from step 3, then
   verify the amount appears correctly in `/finance/ledger` and in
   `/reports/collections`. Numbers that disagree between screens are a P1 finding.
5. **Field operations.** Sign in as Field Employee (`9000000004`). Do a GPS check-in →
   record a field collection → submit a cash handover. Then sign back in as Super Admin
   and complete the cash reconciliation. Test this flow at mobile width (375px) — it is
   the flow real field staff use on phones.
6. **Settings and audit trail.** Change an organization setting, then confirm the change
   is visible in `/admin/settings/changes` and in `/admin/audit`. A change that does not
   produce an audit record is a P0 finding.

## Part 3 — What counts as a functional flaw

- Any `500` or `503` response. **Important:** this codebase renders several distinct
  database errors as a generic "service unavailable" `503`, so the status alone is not
  diagnostic — always capture the exact request URL, payload, and response body.
- Broken links, 404s from in-app navigation, dead buttons.
- Empty states where data plainly should exist (the database is seeded).
- Forms that appear to submit but change nothing, or show no error when they fail.
- Validation that accepts obviously bad input (negative amounts, future dates where past
  is required, malformed mobile numbers, missing mandatory fields).
- **Permission leaks:** a Branch Admin or Field Employee seeing or successfully using a
  surface they should not. Also the inverse — a Super Admin refused something they should
  have. Remember the three deliberately-withheld Super Admin permissions listed above.
- **Scope leaks:** a `BR001` user seeing `BR002` data anywhere.
- Numbers that disagree between two screens showing the same underlying fact.
- Missing loading states (content jumping in) and missing error states (blank screen on
  failure).

## Part 4 — What counts as a UI/UX finding

The app uses **Tailwind v4 (CSS-first)** with design tokens in
`packages/design-tokens/src/theme.css`: brand indigo `#465fff`, Outfit typeface,
`shadow-theme-*` elevation, class-based dark mode, gray-50 page background. There is no
shadcn/ui and no semantic `--background`/`--foreground` token layer — colors are literal
named ramps. **Keep every suggestion inside this system.** Do not propose swapping the UI
library or introducing a different design language.

Evaluate:

- **Table density.** Most screens are data tables. Are columns well chosen? Is there
  sorting, filtering, pagination? Can a user scan a list of 200 loans efficiently?
- **Form ergonomics**, especially the multi-step loan application wizard: is progress
  clear, is going back safe, are errors shown next to the field that caused them?
- **Consistency of empty, loading, and error states** across screens — these are usually
  the least consistent surfaces in an app this size.
- **Dark mode** on every screen. Look for unreadable text, invisible borders, and
  components that never got dark variants.
- **Responsive behavior** at 375px, 768px, and 1280px. Field-operations screens matter
  most at 375px.
- **Accessibility:** keyboard-only navigation, visible focus rings, form labels, color
  contrast, modal focus traps, screen-reader landmarks.
- **Navigation IA.** The sidebar has 12 groups plus the demo leftovers. Is the grouping
  right? Is anything buried? Is there a search or command palette, and should there be?
- **Density and hierarchy** on the dashboard — does it answer "what needs my attention
  today?" at a glance?

## Output format

Report findings as a single table, most severe first:

| # | Route | Role | Severity | What happened | What was expected | Screenshot | Suggested fix |
|---|---|---|---|---|---|---|---|

Severity: **P0** blocks a flow entirely · **P1** wrong behavior or wrong data · **P2**
polish and UX.

Name the likely file for a fix where you can infer it (routes map to
`apps/web/src/app/<route>/page.tsx`; shared primitives live in `packages/ui/src`).

Then add a final section: **Top 10 UI/UX upgrades, ranked by impact ÷ effort** — each one
a single sentence saying what to change and why it matters, ordered so the first item is
the one to do first.
