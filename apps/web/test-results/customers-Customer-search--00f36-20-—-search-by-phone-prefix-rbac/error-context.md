# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customers.spec.ts >> Customer search and scope >> Scenario 20 — search by phone prefix
- Location: e2e\customers.spec.ts:118:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('link', { name: 'Eswari Selvam' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('link', { name: 'Eswari Selvam' })
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
  23  |  * in the single-worker `rbac` project for exactly that reason.
  24  |  *
  25  |  * **What is actually being proved.** The refusals, not the happy paths. A
  26  |  * Branch Admin who reaches Customer Management and is still denied a delete and
  27  |  * a conversion (Scenarios 23, 29); an out-of-branch customer that answers
  28  |  * not-found rather than forbidden (Scenario 21); an unverified LOCAL customer
  29  |  * that cannot be activated (Scenario 14); an incomplete pack that cannot be
  30  |  * approved (Scenario 7); a client-supplied branch that is ignored (Scenario 31).
  31  |  */
  32  | 
  33  | test.describe.configure({ mode: "serial" });
  34  | 
  35  | const SUPER_ADMIN = "9000000013";
  36  | const BRANCH_ADMIN = "9000000014";
  37  | 
  38  | /**
  39  |  * Removes anything left in the scratch range before the suite runs.
  40  |  *
  41  |  * A test that fails partway leaves its scratch customer behind, and the next run
  42  |  * then trips the duplicate-mobile flag instead of testing what it meant to —
  43  |  * which reads as a scope bug rather than as leftover state. Cleaning up front
  44  |  * rather than only in `afterAll` is the same principle the seed follows: the
  45  |  * setup repairs whatever the last run left, so a failure is never inherited.
  46  |  *
  47  |  * Deletes are throttled at 10/minute, and this suite spends several of its own,
  48  |  * so the loop runs only when there is actually something to remove. An
  49  |  * unconditional sweep was enough to exhaust the budget before Scenario 37's
  50  |  * delete — which then failed as a 429 and read exactly like the delete guard
  51  |  * refusing.
  52  |  */
  53  | test.beforeAll(async ({ request }) => {
  54  |   const api = await apiAs(request, SUPER_ADMIN);
  55  |   const response = await api.get("/customers");
  56  |   if (!response.ok()) return;
  57  | 
  58  |   const body = (await response.json()) as {
  59  |     customers: Array<{ customerId: string; customerCode: string }>;
  60  |   };
  61  | 
  62  |   const leftovers = body.customers.filter((customer) =>
  63  |     customer.customerCode.startsWith("CUSTZZ"),
  64  |   );
  65  | 
  66  |   for (const customer of leftovers) {
  67  |     await api.delete(`/customers/${customer.customerId}`);
  68  |   }
  69  | });
  70  | 
  71  | /** Resolves a seeded customer's id by its code, for the direct-call assertions. */
  72  | async function customerIdByCode(
  73  |   api: Awaited<ReturnType<typeof apiAs>>,
  74  |   code: string,
  75  | ): Promise<string> {
  76  |   const response = await api.get(`/customers?search=${code}`);
  77  |   expect(
  78  |     response.ok(),
  79  |     `could not list customers (HTTP ${response.status()}). Run: pnpm --filter @lms/api db:seed`,
  80  |   ).toBe(true);
  81  | 
  82  |   const body = (await response.json()) as {
  83  |     customers: Array<{ customerId: string; customerCode: string }>;
  84  |   };
  85  |   const match = body.customers.find((c) => c.customerCode === code);
  86  | 
  87  |   expect(
  88  |     match,
  89  |     `fixture ${code} is missing. Run: pnpm --filter @lms/api db:seed`,
  90  |   ).toBeDefined();
  91  | 
  92  |   return match!.customerId;
  93  | }
  94  | 
  95  | test.describe("Customer search and scope", () => {
  96  |   test("Scenario 18 — Super Admin searches by name", async ({ page }) => {
  97  |     await page.goto("/customers");
  98  |     await expect(
  99  |       page.getByRole("heading", { name: "Customer Management" }),
  100 |     ).toBeVisible();
  101 | 
  102 |     await page.getByLabel("Search customers").fill("Anitha");
  103 |     await page.getByRole("button", { name: "Search" }).click();
  104 | 
  105 |     await expect(
  106 |       page.getByRole("link", { name: "Anitha Raman" }),
  107 |     ).toBeVisible();
  108 |   });
  109 | 
  110 |   test("Scenario 19 — search by customer ID returns the record", async ({
  111 |     page,
  112 |   }) => {
  113 |     await page.goto("/customers?search=CUST003");
  114 | 
  115 |     await expect(page.getByRole("link", { name: "Chitra Devi" })).toBeVisible();
  116 |   });
  117 | 
  118 |   test("Scenario 20 — search by phone prefix", async ({ page }) => {
  119 |     await page.goto("/customers?search=9100000005");
  120 | 
  121 |     await expect(
  122 |       page.getByRole("link", { name: "Eswari Selvam" }),
> 123 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  124 |   });
  125 | 
  126 |   // Q-CUST-21 — the list is the widest surface in the module.
  127 |   test("mobile numbers are masked in the list", async ({ page }) => {
  128 |     await page.goto("/customers?search=CUST001");
  129 | 
  130 |     await expect(page.getByText("91XXXXXX01")).toBeVisible();
  131 |     await expect(page.getByText("9100000001")).toHaveCount(0);
  132 |   });
  133 | 
  134 |   test("Scenario 22 — the profile shows the unmasked number", async ({
  135 |     page,
  136 |   }) => {
  137 |     await page.goto("/customers?search=CUST001");
  138 |     await page.getByRole("link", { name: "Anitha Raman" }).click();
  139 | 
  140 |     await expect(page.getByText("9100000001")).toBeVisible();
  141 |   });
  142 | });
  143 | 
  144 | /**
  145 |  * Branch confinement (Scenario 21).
  146 |  *
  147 |  * The refusals here are asserted against the **API** rather than through the
  148 |  * browser, and deliberately so: the API is where the rule lives, and a page-level
  149 |  * check would prove only that Next.js rendered a 404 page — which it does by
  150 |  * collapsing the API's own refusal. Asserting the status *and* the message body
  151 |  * is what proves an out-of-scope customer is indistinguishable from an absent
  152 |  * one, which a rendered page cannot show.
  153 |  *
  154 |  * The browser-side half of this is covered by "a BR002 customer is absent from
  155 |  * the list", which does run as the Branch Admin.
  156 |  */
  157 | test.describe("Branch confinement", () => {
  158 |   // Every test here runs as the Branch Admin, who is scoped to BR001.
  159 |   test.use({ storageState: STORAGE_STATE.branchAdmin });
  160 | 
  161 |   test("Scenario 21 — a BR002 customer is absent from the list", async ({
  162 |     page,
  163 |   }) => {
  164 |     await page.goto("/customers");
  165 | 
  166 |     await expect(
  167 |       page.getByRole("link", { name: "Anitha Raman" }),
  168 |     ).toBeVisible();
  169 |     // CUST002 lives in BR002 and must not appear at all.
  170 |     await expect(page.getByRole("link", { name: "Bhaskar Nair" })).toHaveCount(
  171 |       0,
  172 |     );
  173 |   });
  174 | 
  175 |   test("Scenario 21 — searching for a BR002 customer by name finds nothing", async ({
  176 |     page,
  177 |   }) => {
  178 |     await page.goto("/customers?search=Bhaskar");
  179 | 
  180 |     await expect(page.getByText(/No customers match/)).toBeVisible();
  181 |   });
  182 | 
  183 |   test("Scenario 21 — the API answers 404 for an out-of-branch customer", async ({
  184 |     request,
  185 |   }) => {
  186 |     const superApi = await apiAs(request, SUPER_ADMIN);
  187 |     const outOfBranch = await customerIdByCode(superApi, "CUST002");
  188 | 
  189 |     const branchApi = await apiAs(request, BRANCH_ADMIN);
  190 |     const response = await branchApi.get(`/customers/${outOfBranch}`);
  191 | 
  192 |     expect(response.status()).toBe(404);
  193 |     // The message must not distinguish out-of-scope from absent.
  194 |     const body = (await response.json()) as { message?: string };
  195 |     expect(body.message).toBe("Customer not found");
  196 |   });
  197 | 
  198 |   test("Scenario 30 — an unknown id answers exactly as an out-of-scope one", async ({
  199 |     request,
  200 |   }) => {
  201 |     const branchApi = await apiAs(request, BRANCH_ADMIN);
  202 |     const response = await branchApi.get(
  203 |       "/customers/11111111-1111-4111-8111-111111111111",
  204 |     );
  205 | 
  206 |     expect(response.status()).toBe(404);
  207 |     const body = (await response.json()) as { message?: string };
  208 |     expect(body.message).toBe("Customer not found");
  209 |   });
  210 | });
  211 | 
  212 | test.describe("Registration", () => {
  213 |   test("Scenario 3 — customer type is required", async ({ page }) => {
  214 |     await page.goto("/customers/new");
  215 | 
  216 |     await page.getByLabel("Full Name").fill("Scratch Customer");
  217 |     await page.getByLabel("Mobile Number").fill("9190000001");
  218 |     await page.getByLabel("Address Line 1").fill("1 Scratch Street");
  219 |     await page.getByRole("button", { name: "Create Customer" }).click();
  220 | 
  221 |     await expect(page.getByText("Customer Type is required")).toBeVisible();
  222 |   });
  223 | 
```