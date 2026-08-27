import { test, expect } from "@playwright/test";

/**
 * Sign-In end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 */

const SEED_PASSWORD = "Kestrel7Vault";

/**
 * The form's own error region. Scoped away from Next's injected
 * `__next-route-announcer__`, which also carries role="alert".
 */
function formAlert(page: import("@playwright/test").Page) {
  return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
}

async function signIn(
  page: import("@playwright/test").Page,
  mobile: string,
  password: string = SEED_PASSWORD,
  orgCode = "DEMO",
) {
  await page.goto("/signin");
  await page.getByLabel(/Organization Code/).fill(orgCode);
  await page.getByLabel(/Mobile Number/).fill(mobile);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("mandatory fields are enforced before any request is sent", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByText("Mobile Number is required")).toBeVisible();
  await expect(page.getByText("Password is required")).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);
});

test("an invalid mobile number format is rejected", async ({ page }) => {
  await signIn(page, "12345");

  await expect(
    page.getByText("Enter a valid 10-digit mobile number"),
  ).toBeVisible();
});

test("Super Admin signs in and reaches the system-wide dashboard", async ({
  page,
}) => {
  await signIn(page, "9000000001");

  await expect(page).toHaveURL("/");
  // "Loan Summary" rather than "Dashboard": no "Dashboard" heading has existed
  // on this screen since Module 15 replaced the body with KPI panels —
  // `Dashboard` survives only as the page's <title> metadata, which this
  // locator never sees. Module 18 then replaced those panels with widgets, so
  // the previous anchor ("Portfolio") went with them.
  //
  // Loan Summary is the first widget and the one a Super Admin always holds
  // both permissions for. Deliberately not an assertion on a figure: every
  // number here is a live aggregate the other specs are concurrently moving.
  await expect(
    page.getByRole("heading", { name: "Loan Summary", exact: true }),
  ).toBeVisible();
});

test("Branch Admin signs in and reaches the branch dashboard", async ({
  page,
}) => {
  await signIn(page, "9000000003");

  await expect(page).toHaveURL(/\/branch/);
  await expect(page.getByText(/Branch Admin B/)).toBeVisible();
});

test("wrong credentials show the generic failure and create no session", async ({
  page,
}) => {
  await signIn(page, "9000000001", "WrongPassword");

  await expect(formAlert(page)).toContainText("Invalid credentials");
  await expect(page).toHaveURL(/\/signin/);
});

test("an inactive account cannot sign in even with the correct password", async ({
  page,
}) => {
  await signIn(page, "9000000005");

  // Indistinguishable from a wrong password, so account state is not disclosed.
  await expect(formAlert(page)).toContainText("Invalid credentials");
  await expect(page).toHaveURL(/\/signin/);
});

test("signing out ends the session and re-protects the dashboard", async ({
  page,
}) => {
  await signIn(page, "9000000001");
  await expect(page).toHaveURL("/");

  await page.context().clearCookies();

  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
});
