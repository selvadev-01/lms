# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings-governance.nav.spec.ts >> Branch Admin >> reaches branch settings scoped to their own branch
- Location: e2e\settings-governance.nav.spec.ts:83:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/admin/settings/branch
Call log:
  - navigating to "http://localhost:3000/admin/settings/branch", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * Sidebar links for Module 17 lead somewhere real.
  5   |  *
  6   |  * A link added to the nav without its page is invisible in a render test of the
  7   |  * pages themselves — the sidebar entry for Branch Settings pointed at a 404 and
  8   |  * nothing but following the link would have caught it.
  9   |  */
  10  | 
  11  | const LINKS = [
  12  |   "Organization Settings",
  13  |   "Branch Settings",
  14  |   "Configuration Changes",
  15  |   "Operational Controls",
  16  |   "Maintenance Jobs",
  17  |   "Configuration Transfer",
  18  |   "Data Retention",
  19  |   "Audit Trail",
  20  | ];
  21  | 
  22  | test.describe("Super Admin", () => {
  23  |   test.use({ storageState: "e2e/.auth/super-admin.json" });
  24  | 
  25  |   for (const name of LINKS) {
  26  |     test(`sidebar link "${name}" reaches a page`, async ({ page }) => {
  27  |       await page.goto("/");
  28  | 
  29  |       // The group is collapsed until its parent is opened.
  30  |       await page
  31  |         .getByRole("button", { name: /Company Settings/i })
  32  |         .first()
  33  |         .click();
  34  | 
  35  |       const link = page.getByRole("link", { name, exact: true }).first();
  36  |       await expect(link).toBeVisible();
  37  |       await link.click();
  38  | 
  39  |       await expect(
  40  |         page.getByRole("heading", { name: /404/i }),
  41  |       ).toHaveCount(0);
  42  |     });
  43  |   }
  44  | });
  45  | 
  46  | test.describe("Scope separation", () => {
  47  |   test.use({ storageState: "e2e/.auth/super-admin.json" });
  48  | 
  49  |   /**
  50  |    * `GET /settings` without a `branchId` returns EVERY branch's overrides
  51  |    * alongside the organization rows — by design, since a branch-confined caller
  52  |    * needs the org row as their effective default. An unscoped Super Admin
  53  |    * therefore gets them all, and the organization screen has to filter.
  54  |    *
  55  |    * Without that filter the same setting appeared once per branch under one
  56  |    * name, and editing such a row wrote to that branch from a screen headed
  57  |    * "Organization Settings". This asserts no branch-scoped row is shown there.
  58  |    */
  59  |   test("organization settings shows no branch-scoped rows", async ({
  60  |     page,
  61  |   }) => {
  62  |     await page.goto("/admin/settings/organization");
  63  | 
  64  |     await expect(
  65  |       page.getByRole("heading", { name: /Organization Settings/i }).first(),
  66  |     ).toBeVisible();
  67  | 
  68  |     // The Scope column reads "Organization" for every row on this screen.
  69  |     await expect(page.getByRole("cell", { name: "Branch", exact: true })).toHaveCount(
  70  |       0,
  71  |     );
  72  |   });
  73  | });
  74  | 
  75  | test.describe("Branch Admin", () => {
  76  |   test.use({ storageState: "e2e/.auth/branch-admin.json" });
  77  | 
  78  |   /**
  79  |    * The scope boundary: a Branch Admin holds `settings.view` and must REACH
  80  |    * these screens — being refused at the act is what the scenarios assert, and a
  81  |    * 404 or a redirect here would prove nothing about scope.
  82  |    */
  83  |   test("reaches branch settings scoped to their own branch", async ({
  84  |     page,
  85  |   }) => {
> 86  |     await page.goto("/admin/settings/branch");
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/admin/settings/branch
  87  | 
  88  |     await expect(
  89  |       page.getByRole("heading", { name: /Branch Settings/i }).first(),
  90  |     ).toBeVisible();
  91  | 
  92  |     // Pinned to their own branch — no picker is offered.
  93  |     await expect(page.getByLabel("Branch")).toHaveCount(0);
  94  |   });
  95  | 
  96  |   test("reaches the audit trail", async ({ page }) => {
  97  |     await page.goto("/admin/audit");
  98  | 
  99  |     await expect(
  100 |       page.getByRole("heading", { name: /Audit Trail/i }).first(),
  101 |     ).toBeVisible();
  102 |   });
  103 | });
  104 | 
```