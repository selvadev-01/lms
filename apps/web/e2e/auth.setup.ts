import { expect, test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  API_BASE,
  ORG_CODE,
  SEED_PASSWORD,
  STORAGE_STATE,
} from "./support/session";

/**
 * Mints one signed-in browser state per RBAC role, before any spec runs.
 *
 * This is Playwright's intended mechanism, and it replaces a hand-rolled helper
 * that injected cookies at the start of every test. That helper was wrong in two
 * ways that only showed up under load:
 *
 * - **It raced the proxy.** Cookies added to a context are not guaranteed to be
 *   live for the very next navigation, so a test could be served /signin and then
 *   fail much later against a screen that had never rendered — reading as a
 *   component bug rather than an auth one.
 *
 * - **It signed in per test.** Refresh-token rotation revokes the previous
 *   session, so sessions genuinely cannot be shared across contexts; per-test
 *   sign-in was the only alternative, and 43 tests against a 20/minute limit is
 *   over budget by construction.
 *
 * Minting the state once per role here costs three sign-ins for the whole suite,
 * and Playwright loads it before the page ever navigates — so there is no window
 * in which a test is running unauthenticated.
 */

const ACCOUNTS = [
  {
    mobile: "9000000013",
    file: STORAGE_STATE.superAdmin,
    label: "Super Admin",
  },
  {
    mobile: "9000000014",
    file: STORAGE_STATE.branchAdmin,
    label: "Branch Admin",
  },
  { mobile: "9000000015", file: STORAGE_STATE.target, label: "target user" },
] as const;

for (const account of ACCOUNTS) {
  setup(`authenticate as ${account.label}`, async ({ page, context }) => {
    // Through the sign-in form rather than the API, so the cookies Playwright
    // persists are exactly the ones a real session carries, set on this origin.
    await page.goto("/signin");
    await page.getByLabel(/Organization Code/).fill(ORG_CODE);
    await page.getByLabel(/Mobile Number/).fill(account.mobile);
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/(branch|field)?$/, { timeout: 20_000 });

    // The URL settling is not the same as the session settling. `/` became a
    // real dashboard in Module 15 — it fetches report KPIs server-side — and the
    // navigation resolves while the response that sets `lms_at` is still in
    // flight. Snapshotting there captured a state holding only the refresh
    // cookie, which then made every UI test in the Super Admin's project land
    // on the sign-in page.
    //
    // Waiting for the access cookie to actually exist is the assertion that
    // matters, rather than waiting on a load event that has already fired.
    await expect
      .poll(
        async () => {
          const cookies = await context.cookies();
          return cookies.some((cookie) => cookie.name === "lms_at");
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    mkdirSync(dirname(account.file), { recursive: true });
    await context.storageState({ path: account.file });
  });
}

setup("the API is reachable and seeded", async ({ request }) => {
  // Fails here with a clear message rather than as 43 confusing assertion
  // failures if the API is down or the seed has not been applied.
  const response = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
    data: {
      orgCode: ORG_CODE,
      mobile: "9000000013",
      password: SEED_PASSWORD,
    },
  });

  expect(
    response.ok(),
    `sign-in as 9000000013 failed (HTTP ${response.status()}). Run: pnpm --filter @lms/api db:seed`,
  ).toBe(true);
});
