# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps\web\e2e\gps-check-in.spec.ts >> GPS Check-in >> Scenario 2: an unauthenticated user cannot open GPS Check-in
- Location: apps\web\e2e\gps-check-in.spec.ts:74:7

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/field/check-in", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * Field Employee GPS Check-in end-to-end coverage.
  5   |  *
  6   |  * Requires the API running on API_BASE_URL with the development seed applied
  7   |  * (`pnpm --filter @lms/api db:seed`).
  8   |  *
  9   |  * ACCOUNT OWNERSHIP: this spec owns 9000000009 (active Field Employee) and
  10  |  * 9000000010 (inactive Field Employee) exclusively. It creates check-in rows
  11  |  * and revokes sessions, so sharing either account would make another spec's
  12  |  * state shift underneath it. Neither password is changed, so no restoration is
  13  |  * needed.
  14  |  *
  15  |  * The load-bearing tests are "an unverified employee cannot reach field
  16  |  * operations" (Scenario 5) and "a denied permission never verifies"
  17  |  * (Scenario 7). Together they are what would catch a regression that let the
  18  |  * fail-closed rule slip.
  19  |  *
  20  |  * Serial, because a verified check-in persists for 12 hours: a test that
  21  |  * verifies changes what the next test sees. Order is deliberate — the
  22  |  * unverified-gate tests run before anything checks in successfully.
  23  |  */
  24  | 
  25  | test.describe.configure({ mode: "serial" });
  26  | 
  27  | const SEED_PASSWORD = "Kestrel7Vault";
  28  | const OWNED_MOBILE = "9000000009";
  29  | const INACTIVE_MOBILE = "9000000010";
  30  | const ADMIN_MOBILE = "9000000002";
  31  | const ORG_CODE = "DEMO";
  32  | 
  33  | const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";
  34  | 
  35  | /** Chennai — the seeded Branch A city, so the fixture reads plausibly. */
  36  | const CHENNAI = { latitude: 13.0827, longitude: 80.2707 };
  37  | 
  38  | /**
  39  |  * Signs in and waits for the post-sign-in redirect to settle.
  40  |  *
  41  |  * Waiting matters here more than in the other specs: a Field Employee lands on
  42  |  * `/field`, which immediately redirects again to `/field/check-in` when there
  43  |  * is no verified check-in. Returning before that second hop lands would let a
  44  |  * following `goto` interrupt an in-flight navigation and leave the test on the
  45  |  * sign-in page.
  46  |  */
  47  | async function signIn(
  48  |   page: Page,
  49  |   mobile: string = OWNED_MOBILE,
  50  | ): Promise<void> {
  51  |   await page.goto("/signin");
  52  |   await page.getByLabel(/Organization Code/).fill(ORG_CODE);
  53  |   await page.getByLabel(/Mobile Number/).fill(mobile);
  54  |   await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
  55  |   await page.getByRole("button", { name: "Sign in", exact: true }).click();
  56  |   await expect(page).not.toHaveURL(/\/signin/);
  57  | }
  58  | 
  59  | /** Scoped away from Next's route announcer, which is also role="alert". */
  60  | function formAlert(page: Page) {
  61  |   return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
  62  | }
  63  | 
  64  | function verifyButton(page: Page) {
  65  |   return page.getByRole("button", { name: /Verify my location|Check location again/ });
  66  | }
  67  | 
  68  | test.describe("GPS Check-in", () => {
  69  |   test.use({
  70  |     permissions: ["geolocation"],
  71  |     geolocation: CHENNAI,
  72  |   });
  73  | 
  74  |   test("Scenario 2: an unauthenticated user cannot open GPS Check-in", async ({
  75  |     page,
  76  |   }) => {
> 77  |     await page.goto("/field/check-in");
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  78  | 
  79  |     await expect(page).toHaveURL(/\/signin/);
  80  |   });
  81  | 
  82  |   test("Scenario 5: an unverified field employee is sent to check in", async ({
  83  |     page,
  84  |   }) => {
  85  |     await signIn(page);
  86  | 
  87  |     // Signing in lands on /field, which has no verified check-in yet and must
  88  |     // redirect rather than showing field operations.
  89  |     await expect(page).toHaveURL(/\/field\/check-in$/);
  90  |     // Level 3 specifically: the breadcrumb renders the same text as an h2.
  91  |     await expect(
  92  |       page.getByRole("heading", { name: "GPS Check-in", level: 3 }),
  93  |     ).toBeVisible();
  94  |   });
  95  | 
  96  |   test("Scenario 7: a denied location permission never verifies", async ({
  97  |     page,
  98  |     context,
  99  |   }) => {
  100 |     await signIn(page);
  101 |     await page.goto("/field/check-in");
  102 | 
  103 |     await context.clearPermissions();
  104 |     await verifyButton(page).click();
  105 | 
  106 |     await expect(formAlert(page)).toContainText(/Location permission is blocked/i);
  107 |     await expect(formAlert(page)).not.toContainText(/Location verified/i);
  108 | 
  109 |     // Still gated: a failed attempt must not unlock field operations.
  110 |     await page.goto("/field");
  111 |     await expect(page).toHaveURL(/\/field\/check-in$/);
  112 |   });
  113 | 
  114 |   test("Scenario 13: a failed attempt can be retried from the same screen", async ({
  115 |     page,
  116 |     context,
  117 |   }) => {
  118 |     await signIn(page);
  119 |     await page.goto("/field/check-in");
  120 | 
  121 |     await context.clearPermissions();
  122 |     await verifyButton(page).click();
  123 |     await expect(formAlert(page)).toContainText(/permission is blocked/i);
  124 | 
  125 |     // The retry control is the same button, relabelled — the user is not sent
  126 |     // anywhere to try again.
  127 |     await expect(
  128 |       page.getByRole("button", { name: "Check location again" }),
  129 |     ).toBeVisible();
  130 |   });
  131 | 
  132 |   test("Scenarios 4, 15: a granted location verifies, after an earlier failure", async ({
  133 |     page,
  134 |     context,
  135 |   }) => {
  136 |     await signIn(page);
  137 |     await page.goto("/field/check-in");
  138 | 
  139 |     await context.clearPermissions();
  140 |     await verifyButton(page).click();
  141 |     await expect(formAlert(page)).toContainText(/permission is blocked/i);
  142 | 
  143 |     await context.grantPermissions(["geolocation"]);
  144 |     await page.getByRole("button", { name: "Check location again" }).click();
  145 | 
  146 |     await expect(formAlert(page)).toContainText(/Location verified/i);
  147 |   });
  148 | 
  149 |   test("Scenario 5: a verified check-in unlocks field operations", async ({
  150 |     page,
  151 |   }) => {
  152 |     await signIn(page);
  153 |     await page.goto("/field/check-in");
  154 | 
  155 |     await verifyButton(page).click();
  156 |     await expect(formAlert(page)).toContainText(/Location verified/i);
  157 | 
  158 |     await page.getByRole("button", { name: /Continue to field operations/ }).click();
  159 | 
  160 |     await expect(page).toHaveURL(/\/field$/);
  161 |     await expect(page.getByText(/Location verified/i)).toBeVisible();
  162 |   });
  163 | 
  164 |   test("Scenario 24: verifying does not change the employee's branch", async ({
  165 |     page,
  166 |     context,
  167 |   }) => {
  168 |     // Coimbatore is Branch B's city; this employee belongs to Branch A. A
  169 |     // location near another branch must not reassign them.
  170 |     await context.setGeolocation({ latitude: 11.0168, longitude: 76.9558 });
  171 | 
  172 |     await signIn(page);
  173 |     await page.goto("/field/check-in");
  174 |     await verifyButton(page).click();
  175 |     await expect(formAlert(page)).toContainText(/Location verified/i);
  176 | 
  177 |     const response = await page.request.get(
```