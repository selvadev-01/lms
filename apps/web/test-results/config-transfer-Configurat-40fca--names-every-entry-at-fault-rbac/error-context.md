# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: config-transfer.spec.ts >> Configuration Transfer >> Scenario 60: a rejected import names every entry at fault
- Location: e2e\config-transfer.spec.ts:15:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByLabel('Configuration document')
    - waiting for "http://localhost:3000/signin" navigation to finish...
    - navigated to "http://localhost:3000/signin"

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e4]:
    - generic [ref=f1e5]:
      - link "Back to dashboard" [ref=f1e7] [cursor=pointer]:
        - /url: /
      - generic [ref=f1e11]:
        - generic [ref=f1e12]:
          - heading "Sign In" [level=1] [ref=f1e13]
          - paragraph [ref=f1e14]: Enter your organization code, mobile number and password to sign in.
        - alert
        - generic [ref=f1e16]:
          - generic [ref=f1e17]:
            - generic [ref=f1e18]: Organization Code *
            - textbox "Organization Code *" [ref=f1e20]:
              - /placeholder: Enter your organization code
          - generic [ref=f1e21]:
            - generic [ref=f1e22]: Mobile Number *
            - textbox "Mobile Number *" [ref=f1e24]:
              - /placeholder: 10-digit mobile number
          - generic [ref=f1e25]:
            - generic [ref=f1e26]: Password *
            - generic [ref=f1e27]:
              - textbox "Password *" [ref=f1e29]:
                - /placeholder: Enter your password
              - button "Show password" [ref=f1e30] [cursor=pointer]
          - link "Forgot password?" [ref=f1e34] [cursor=pointer]:
            - /url: /forgot-password
          - button "Sign in" [ref=f1e36] [cursor=pointer]
    - generic [ref=f1e38]:
      - img "grid" [ref=f1e40]
      - img "grid" [ref=f1e42]
      - generic [ref=f1e43]:
        - link [ref=f1e44] [cursor=pointer]:
          - /url: /
          - img "Logo" [ref=f1e45]
        - paragraph [ref=f1e46]: Sign in to continue to your workspace.
    - button [ref=f1e48] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=f1e56] [cursor=pointer]
  - alert [ref=f1e60]
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * Configuration import through the UI (Scenarios 59-62).
  5  |  *
  6  |  * The per-entry `problems` list travels a path nothing else uses: the API puts
  7  |  * it beside `message` in a 400 body, and `api-call.ts` has to forward it or the
  8  |  * generic failure state drops it silently. A unit test of the service cannot
  9  |  * catch that, because the loss happens in the web layer.
  10 |  */
  11 | 
  12 | test.use({ storageState: "e2e/.auth/super-admin.json" });
  13 | 
  14 | test.describe("Configuration Transfer", () => {
  15 |   test("Scenario 60: a rejected import names every entry at fault", async ({
  16 |     page,
  17 |   }) => {
  18 |     await page.goto("/admin/settings/transfer");
  19 | 
> 20 |     await page.getByLabel("Configuration document").fill(
     |                                                     ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  21 |       JSON.stringify({
  22 |         schemaVersion: 1,
  23 |         settings: [
  24 |           { settingCode: "MADE_UP_KEY", value: "x" },
  25 |           { settingCode: "ANOTHER_FAKE", value: "y" },
  26 |         ],
  27 |       }),
  28 |     );
  29 | 
  30 |     await page.getByRole("button", { name: /Import/i }).click();
  31 | 
  32 |     await expect(
  33 |       page.getByRole("heading", { name: "Not imported" }),
  34 |     ).toBeVisible();
  35 | 
  36 |     // The point of the test: both codes are named, not just a generic failure.
  37 |     await expect(page.getByText("MADE_UP_KEY")).toBeVisible();
  38 |     await expect(page.getByText("ANOTHER_FAKE")).toBeVisible();
  39 |   });
  40 | 
  41 |   test("a dry run reports what would change and writes nothing", async ({
  42 |     page,
  43 |   }) => {
  44 |     await page.goto("/admin/settings/transfer");
  45 | 
  46 |     await page.getByLabel("Configuration document").fill(
  47 |       JSON.stringify({
  48 |         schemaVersion: 1,
  49 |         settings: [{ settingCode: "ORG_DISPLAY_NAME", value: "Dry Run Only" }],
  50 |       }),
  51 |     );
  52 | 
  53 |     // Checked by default; asserted rather than assumed, because an unchecked
  54 |     // box here would write the value this test claims it does not.
  55 |     await expect(
  56 |       page.getByRole("checkbox", { name: /Check only/i }),
  57 |     ).toBeChecked();
  58 | 
  59 |     await page.getByRole("button", { name: /Import/i }).click();
  60 | 
  61 |     await expect(page.getByText(/Nothing was written/i)).toBeVisible();
  62 |   });
  63 | 
  64 |   test("malformed JSON is refused before the request is sent", async ({
  65 |     page,
  66 |   }) => {
  67 |     await page.goto("/admin/settings/transfer");
  68 | 
  69 |     await page.getByLabel("Configuration document").fill("{not json");
  70 |     await page.getByRole("button", { name: /Import/i }).click();
  71 | 
  72 |     await expect(page.getByText(/not valid JSON/i)).toBeVisible();
  73 |   });
  74 | });
  75 | 
```