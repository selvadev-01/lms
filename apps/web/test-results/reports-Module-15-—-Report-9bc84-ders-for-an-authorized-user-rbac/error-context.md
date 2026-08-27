# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reports.spec.ts >> Module 15 — Reports & Analytics >> Scenario 1: the dashboard renders for an authorized user
- Location: e2e\reports.spec.ts:41:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Reporting Dashboard' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Reporting Dashboard' })
    - waiting for "http://localhost:3000/signin" navigation to finish...
    - navigated to "http://localhost:3000/signin"

```

```yaml
- link "Back to dashboard":
  - /url: /
  - img
  - text: Back to dashboard
- heading "Sign In" [level=1]
- paragraph: Enter your organization code, mobile number and password to sign in.
- alert
- text: Organization Code *
- textbox "Organization Code *":
  - /placeholder: Enter your organization code
- text: Mobile Number *
- textbox "Mobile Number *":
  - /placeholder: 10-digit mobile number
- text: Password *
- textbox "Password *":
  - /placeholder: Enter your password
- button "Show password":
  - img
- link "Forgot password?":
  - /url: /forgot-password
- button "Sign in"
- img "grid"
- img "grid"
- link "Logo":
  - /url: /
  - img "Logo"
- paragraph: Sign in to continue to your workspace.
- button:
  - img
- alert
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | import { apiAs } from "./support/session";
  4   | 
  5   | /**
  6   |  * Module 15 — Reports & Analytics.
  7   |  *
  8   |  * The scenarios that can only be proved end to end: that a Branch Admin's
  9   |  * report is confined to their branch even when they ask otherwise, that a
  10  |  * report they may read they may not always export, and — the one that makes the
  11  |  * whole reuse decision enforceable — that the financial report's totals equal
  12  |  * Module 14's ledger for the same range.
  13  |  *
  14  |  * # Why this runs in the RBAC project
  15  |  *
  16  |  * Reports read across every module. The rows they return come from the same
  17  |  * seeded and spec-created fixtures that `disbursal.spec.ts`, `collections.spec.ts`,
  18  |  * `field-cash.spec.ts`, `accounting.spec.ts` and `overdue-recovery.spec.ts` are
  19  |  * concurrently creating and mutating, through the `APP-`, `SL-`, `LN-`, `RCP-`,
  20  |  * `CH-`, `CR-`, `JE-` and `RC-` sequences. A parallel run would have this spec
  21  |  * asserting on totals that another worker is changing mid-query.
  22  |  *
  23  |  * # No fixtures of its own
  24  |  *
  25  |  * Every other spec in the RBAC group creates rows and sweeps them afterwards.
  26  |  * This one deliberately creates nothing: reports are read-only (Rules 5, 6, 17),
  27  |  * and a report spec that had to write data to test itself would be evidence the
  28  |  * module was not read-only. It asserts against whatever the seeded book holds,
  29  |  * which is why every assertion below is a relationship — a total equals another
  30  |  * total, a scope excludes a branch — rather than a fixed number that a
  31  |  * concurrently-running spec could move.
  32  |  */
  33  | 
  34  | const SUPER_ADMIN = "9000000013";
  35  | const BRANCH_ADMIN = "9000000014";
  36  | 
  37  | test.describe.configure({ mode: "serial" });
  38  | test.setTimeout(150_000);
  39  | 
  40  | test.describe("Module 15 — Reports & Analytics", () => {
  41  |   test("Scenario 1: the dashboard renders for an authorized user", async ({
  42  |     page,
  43  |   }) => {
  44  |     await page.goto("/reports/dashboard");
  45  | 
  46  |     await expect(
  47  |       page.getByRole("heading", { name: "Reporting Dashboard" }),
> 48  |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  49  | 
  50  |     // The four KPI groups. They are separate panels because they answer to
  51  |     // different date bases (Rule 11), so their presence as distinct headings is
  52  |     // the assertion, not decoration.
  53  |     await expect(
  54  |       page.getByRole("heading", { name: "Portfolio" }),
  55  |     ).toBeVisible();
  56  |     await expect(
  57  |       page.getByRole("heading", { name: "Collections" }),
  58  |     ).toBeVisible();
  59  |     await expect(
  60  |       page.getByRole("heading", { name: "Delinquency" }),
  61  |     ).toBeVisible();
  62  |     await expect(page.getByRole("heading", { name: "Recovery" })).toBeVisible();
  63  |   });
  64  | 
  65  |   test("Scenario 4: the dashboard states its data freshness", async ({
  66  |     page,
  67  |   }) => {
  68  |     await page.goto("/reports/dashboard");
  69  | 
  70  |     // Rule 36: aggregated data must not be presented as real-time without an
  71  |     // indicator. Nothing is cached today, so the indicator says "now" — which
  72  |     // is the truth, and is the field a cache's staleness would surface in.
  73  |     await expect(page.getByText(/data as at/i).first()).toBeVisible();
  74  |   });
  75  | 
  76  |   test("Scenario 7: the portfolio report lists loans with outstanding balances", async ({
  77  |     page,
  78  |   }) => {
  79  |     await page.goto("/reports/portfolio");
  80  | 
  81  |     await expect(
  82  |       page.getByRole("heading", { name: "Loan Portfolio Report" }),
  83  |     ).toBeVisible();
  84  | 
  85  |     // The declared basis is stated on the screen, per Rule 10.
  86  |     await expect(page.getByText(/filtered by.*disbursal date/i)).toBeVisible();
  87  |   });
  88  | 
  89  |   test("Scenario 12: each report states the date basis it applied", async ({
  90  |     page,
  91  |   }) => {
  92  |     // The pairing that matters: two reports over the same data, each naming a
  93  |     // different column. A report that silently used another module's basis
  94  |     // would show the wrong one here.
  95  |     await page.goto("/reports/applications");
  96  |     await expect(
  97  |       page.getByText(/filtered by.*application date/i),
  98  |     ).toBeVisible();
  99  | 
  100 |     await page.goto("/reports/collections");
  101 |     await expect(page.getByText(/filtered by.*collection date/i)).toBeVisible();
  102 |   });
  103 | 
  104 |   test("Scenario 9: an inverted date range is refused", async ({ request }) => {
  105 |     const api = await apiAs(request, SUPER_ADMIN);
  106 | 
  107 |     const response = await api.get(
  108 |       "/reports/collections?fromDate=2026-02-01&toDate=2026-01-01",
  109 |     );
  110 | 
  111 |     expect(response.status()).toBe(400);
  112 |     expect(await response.text()).toContain("To Date must be on or after");
  113 |   });
  114 | 
  115 |   test("Scenario 62: a range beyond the configured limit is refused, not truncated", async ({
  116 |     request,
  117 |   }) => {
  118 |     const api = await apiAs(request, SUPER_ADMIN);
  119 | 
  120 |     const response = await api.get(
  121 |       "/reports/collections?fromDate=2020-01-01&toDate=2026-12-31",
  122 |     );
  123 | 
  124 |     // Refused rather than clamped. A silently narrowed range returns a report
  125 |     // that looks complete and answers a different question.
  126 |     expect(response.status()).toBe(400);
  127 |     expect(await response.text()).toContain("Date range cannot exceed");
  128 |   });
  129 | 
  130 |   test("Scenario 10: a report refuses a date basis it does not permit", async ({
  131 |     request,
  132 |   }) => {
  133 |     const api = await apiAs(request, SUPER_ADMIN);
  134 | 
  135 |     // An application report filtered by disbursal date would silently drop
  136 |     // every application that was never disbursed.
  137 |     const response = await api.get(
  138 |       "/reports/applications?dateBasis=DISBURSAL_DATE",
  139 |     );
  140 | 
  141 |     expect(response.status()).toBe(400);
  142 |     expect(await response.text()).toContain("cannot be filtered by that date");
  143 |   });
  144 | 
  145 |   test("Scenario 16: totals are computed over the whole filtered dataset", async ({
  146 |     request,
  147 |   }) => {
  148 |     const api = await apiAs(request, SUPER_ADMIN);
```