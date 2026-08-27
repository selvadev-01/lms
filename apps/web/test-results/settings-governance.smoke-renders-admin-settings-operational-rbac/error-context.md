# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings-governance.smoke.spec.ts >> renders /admin/settings/operational
- Location: e2e\settings-governance.smoke.spec.ts:27:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/admin/settings/operational
Call log:
  - navigating to "http://localhost:3000/admin/settings/operational", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * Module 17 render smoke check.
  5  |  *
  6  |  * This is NOT the scenario suite — it asserts only that each new screen reaches
  7  |  * a rendered heading rather than a Next.js error overlay or an empty shell. A
  8  |  * server component that throws still returns 200 with an error page, so the
  9  |  * status code alone would not catch a broken page; the heading is what proves
  10 |  * the component tree actually rendered.
  11 |  */
  12 | 
  13 | const PAGES = [
  14 |   { path: "/admin/settings/organization", heading: /Organization Settings/i },
  15 |   { path: "/admin/settings/branch", heading: /Branch Settings/i },
  16 |   { path: "/admin/settings/changes", heading: /Configuration Changes/i },
  17 |   { path: "/admin/settings/operational", heading: /Operational Controls/i },
  18 |   { path: "/admin/settings/transfer", heading: /Configuration Transfer/i },
  19 |   { path: "/admin/settings/retention", heading: /Data Retention/i },
  20 |   { path: "/admin/maintenance/jobs", heading: /Maintenance Jobs/i },
  21 |   { path: "/admin/audit", heading: /Audit Trail/i },
  22 | ];
  23 | 
  24 | test.use({ storageState: "e2e/.auth/super-admin.json" });
  25 | 
  26 | for (const page of PAGES) {
  27 |   test(`renders ${page.path}`, async ({ page: p }) => {
  28 |     const errors: string[] = [];
  29 |     p.on("pageerror", (error) => errors.push(error.message));
  30 | 
> 31 |     await p.goto(page.path);
     |             ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/admin/settings/operational
  32 | 
  33 |     await expect(
  34 |       p.getByRole("heading", { name: page.heading }).first(),
  35 |     ).toBeVisible();
  36 | 
  37 |     // A client component that throws leaves the heading in place, so the
  38 |     // absence of the heading is not the only failure worth catching.
  39 |     expect(errors).toEqual([]);
  40 |   });
  41 | }
  42 | 
```