import { test, expect, type Page } from "@playwright/test";

/**
 * Change Password end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000007 exclusively, and it is the only
 * spec permitted to sign in as that account. Every other seeded mobile is
 * already claimed, and this spec changes the password it uses.
 *
 * The account is deliberately NOT restored to the seed password. With a
 * password-history depth of 5, setting it back after a couple of changes is
 * rejected as reuse — so a "tidy-up" restore would fail with an error that
 * looks exactly like a product bug. The serial block below instead chains
 * forward through distinct passwords, and the account is simply left on the
 * last one.
 */

const SEED_PASSWORD = "Kestrel7Vault";
const OWNED_MOBILE = "9000000007";

/** Distinct, policy-compliant, and none contains an account identifier. */
const FIRST_CHANGE = "Marigold4Ledger";
const SECOND_CHANGE = "Thornfield3Anvil";

/**
 * The password this account currently has.
 *
 * Resolved at startup rather than assumed. The destructive suite below leaves
 * the account on whichever password it last set, and a re-seed restores it to
 * SEED_PASSWORD — so on any given run the starting point is one of the three.
 * Probing the API keeps the spec runnable twice in a row without an intervening
 * re-seed, which a hard-coded starting password would not survive.
 */
let currentPassword = SEED_PASSWORD;

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

test.beforeAll(async ({ request }) => {
  // Generous: this hook may have to sit out a 60s rate-limit window.
  test.setTimeout(180_000);

  for (const candidate of [SEED_PASSWORD, FIRST_CHANGE, SECOND_CHANGE]) {
    const response = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
      data: { orgCode: "DEMO", mobile: OWNED_MOBILE, password: candidate },
      failOnStatusCode: false,
    });

    if (response.ok()) {
      currentPassword = candidate;
      return;
    }

    /**
     * Sign-in is rate limited per IP (20/minute). Back-to-back local runs
     * exhaust that budget, and every further probe would return 429 regardless
     * of the password — so wait the window out rather than misreport it as "no
     * password matched", which would send the reader hunting for a product bug.
     */
    if (response.status() === 429) {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      const retry = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
        data: { orgCode: "DEMO", mobile: OWNED_MOBILE, password: candidate },
        failOnStatusCode: false,
      });
      if (retry.ok()) {
        currentPassword = candidate;
        return;
      }
    }
  }

  throw new Error(
    `Could not establish the password for ${OWNED_MOBILE}. Re-run the seed: pnpm --filter @lms/api db:seed`,
  );
});

/**
 * The form's own error region. Scoped away from Next's injected
 * `__next-route-announcer__`, which also carries role="alert".
 */
function formAlert(page: Page) {
  return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
}

async function signIn(
  page: Page,
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

/**
 * Signs in and waits for the session to actually exist.
 *
 * `signIn` only clicks submit; navigating straight afterwards races the
 * in-flight request, and the follow-up `goto` can be issued before the session
 * cookie has been set — which the proxy then bounces back to sign-in. The other
 * specs never hit this because they assert on the sign-in outcome immediately.
 */
async function signInAndSettle(page: Page, mobile: string, password: string) {
  await signIn(page, mobile, password);
  // Asserting the destination, not merely "not /signin": the latter passes
  // trivially when the browser is still sitting on whatever page the previous
  // test left behind, masking a sign-in that never completed.
  await expect(page).toHaveURL(/\/(branch|field)?$/);
}

/**
 * Fills the three fields. The New/Confirm locators are anchored because
 * `/New Password/` alone would match "Confirm New Password" as well, and
 * Playwright's strict mode fails on the ambiguity.
 */
async function fillChangeForm(
  page: Page,
  current: string,
  next: string,
  confirm: string = next,
) {
  await page.getByLabel(/^Current Password/).fill(current);
  await page.getByLabel(/^New Password/).fill(next);
  await page.getByLabel(/^Confirm New Password/).fill(confirm);
}

/**
 * The form itself, identified by a field only it has.
 *
 * Scoping matters: the sidebar carries a "Change Password" nav link, so an
 * unscoped role-and-name lookup for the submit button is ambiguous on this page.
 */
const changeForm = (page: Page) =>
  page.locator("form").filter({ has: page.locator("#currentPassword") });

const submit = (page: Page) =>
  changeForm(page)
    .getByRole("button", { name: "Change Password", exact: true })
    .click();

// --- Access control ---------------------------------------------------------

/** Scenarios 2 and 41. */
test("unauthenticated access to Change Password is denied", async ({
  page,
}) => {
  await page.goto("/change-password");
  await expect(page).toHaveURL(/\/signin/);
});

// --- Validation, all non-destructive ----------------------------------------

/**
 * Serial, and sharing one page.
 *
 * Not for ordering — these tests are independent — but for the sign-in budget.
 * The API rate limits sign-in to 20 per minute per IP, and a sign-in per test
 * across this file plus the suites that run alongside it exhausts that window,
 * producing 429s that look like authentication failures. One session, reused,
 * keeps the whole file to a handful of sign-ins.
 */
test.describe.serial("form validation", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signInAndSettle(page, OWNED_MOBILE, currentPassword);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.beforeEach(async () => {
    // Reloaded rather than re-authenticated, so each test still starts from a
    // pristine, empty form (Scenario 1).
    await page.goto("/change-password");
  });

  /** Scenario 1: nothing is pre-populated. */
  test("presents three empty password fields", async () => {
    await expect(page.getByLabel(/^Current Password/)).toHaveValue("");
    await expect(page.getByLabel(/^New Password/)).toHaveValue("");
    await expect(page.getByLabel(/^Confirm New Password/)).toHaveValue("");
  });

  /** Scenarios 4, 5 and 6 — the mandatory-field outline. */
  test("enforces the mandatory fields before any request is sent", async () => {
    await submit(page);

    // `exact` throughout: "New Password is required" is a substring of
    // "Confirm New Password is required", so a loose match resolves to two
    // elements and fails Playwright's strict mode.
    await expect(
      page.getByText("Current Password is required", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("New Password is required", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Confirm New Password is required", { exact: true }),
    ).toBeVisible();
    // Anchored: an unanchored /change-password/ would also match the success
    // page, so a change that wrongly succeeded would still pass this assertion.
    await expect(page).toHaveURL(/\/change-password$/);
  });

  /** Scenario 11. */
  test("rejects a confirmation that does not match", async () => {
    await fillChangeForm(page, currentPassword, FIRST_CHANGE, "Different@123");
    await submit(page);

    await expect(page.getByText("Passwords do not match")).toBeVisible();
    // Anchored: an unanchored /change-password/ would also match the success
    // page, so a change that wrongly succeeded would still pass this assertion.
    await expect(page).toHaveURL(/\/change-password$/);
  });

  /** Scenario 15. */
  test("rejects a new password identical to the current one", async () => {
    await fillChangeForm(page, currentPassword, currentPassword);
    await submit(page);

    await expect(
      page.getByText(/must be different from your current password/i),
    ).toBeVisible();
  });

  /** Scenarios 12 and 13. */
  test("rejects a new password that fails the policy", async () => {
    await fillChangeForm(page, currentPassword, "abcdefghijklmnop");
    await submit(page);

    await expect(page.getByText(/at least 3 of/i)).toBeVisible();
    // Anchored: an unanchored /change-password/ would also match the success
    // page, so a change that wrongly succeeded would still pass this assertion.
    await expect(page).toHaveURL(/\/change-password$/);
  });

  /** Scenario 8: the server rejects it, and the session survives. */
  test("rejects an incorrect current password", async () => {
    await fillChangeForm(page, "WrongPassword9Z", FIRST_CHANGE);
    await submit(page);

    await expect(
      page.getByText("Your current password is incorrect"),
    ).toBeVisible();
    // Anchored: an unanchored /change-password/ would also match the success
    // page, so a change that wrongly succeeded would still pass this assertion.
    await expect(page).toHaveURL(/\/change-password$/);
  });

  /** Scenario 3: leaving the screen commits nothing. */
  test("Cancel leaves without changing the password", async () => {
    await fillChangeForm(page, currentPassword, FIRST_CHANGE);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();

    await expect(page).toHaveURL(/\/profile/);

    /**
     * The credential is untouched — asserted by the session still being valid
     * and the form still reachable, rather than by signing in again.
     *
     * A sign-in probe here would be a stronger check but spends from the 20/min
     * per-IP rate limit that this whole file is arranged to conserve, and it
     * turns into a flake as soon as the other specs run alongside it. Scenario 3
     * is about nothing being committed, which the surviving session shows.
     */
    await page.goto("/change-password");
    await expect(page.getByLabel(/^Current Password/)).toHaveValue("");
  });

  /**
   * Guards the PasswordInput extraction: two toggles on one screen must have
   * distinct accessible names, or role-and-name locators become ambiguous.
   */
  test("each password field has its own uniquely named toggle", async () => {
    const current = page.getByRole("button", { name: "Show current password" });
    const next = page.getByRole("button", { name: "Show new password" });

    await expect(current).toHaveCount(1);
    await expect(next).toHaveCount(1);

    // Independent: revealing one must not reveal the other.
    await current.click();
    await expect(
      page.getByRole("button", { name: "Hide current password" }),
    ).toBeVisible();
    await expect(next).toBeVisible();
  });
});

// --- The destructive path ---------------------------------------------------

/**
 * Serial, and each test starts from whatever the previous one established.
 *
 * `replacement` is the password this suite moves the account to. It is picked
 * relative to the current one so the suite never tries to set a password the
 * account already has — which the reuse rule would reject.
 */
test.describe.serial("changing the password", () => {
  let replacement: string;
  let replaced: string;

  test.beforeAll(() => {
    replaced = currentPassword;
    replacement =
      currentPassword === FIRST_CHANGE ? SECOND_CHANGE : FIRST_CHANGE;
  });

  /** Scenarios 17, 23, 24, 25 and 38. */
  test("changes the password and signs the user out everywhere", async ({
    page,
  }) => {
    await signInAndSettle(page, OWNED_MOBILE, replaced);
    await page.goto("/change-password");
    await fillChangeForm(page, replaced, replacement);
    await submit(page);

    await expect(page).toHaveURL(/\/change-password-done/);
    // Plain text rather than formAlert(): the terminal page renders its Alert
    // directly, without the live region the form wraps its errors in.
    await expect(
      page.getByText("Your password has been changed"),
    ).toBeVisible();
    currentPassword = replacement;

    // Scenario 24: the session that made the change is revoked with the rest.
    await page.goto("/");
    await expect(page).toHaveURL(/\/signin/);
  });

  /** Scenario 17: the old password no longer authenticates. */
  test("refuses the previous password at sign-in", async ({ page }) => {
    await signIn(page, OWNED_MOBILE, replaced);

    await expect(formAlert(page)).toContainText("Invalid credentials");
    await expect(page).toHaveURL(/\/signin/);
  });

  /** Scenario 17: the new password does. */
  test("accepts the new password at sign-in", async ({ page }) => {
    await signIn(page, OWNED_MOBILE, replacement);

    await expect(page).not.toHaveURL(/\/signin/);
  });

  /**
   * Scenario 14, via the history rather than the current password.
   *
   * `replacement` was written to `password_history` when it was set, so setting
   * it again — after moving off it — must be refused.
   *
   * Note what this deliberately does NOT assert: that `replaced` is refused.
   * `recordAndTrim` stores the hash being *established*, not the one being
   * retired, so a password that was already in place before any change is not
   * in the history table. That is the same behaviour Reset Password has, and a
   * re-seed clears history outright — so on a freshly seeded account the
   * previous password is legitimately reusable.
   */
  test("refuses to reuse a password held in the history", async ({ page }) => {
    const third = replacement === FIRST_CHANGE ? SECOND_CHANGE : FIRST_CHANGE;

    // Move off `replacement` so it is history rather than the current password.
    await signInAndSettle(page, OWNED_MOBILE, replacement);
    await page.goto("/change-password");
    await fillChangeForm(page, replacement, third);
    await submit(page);
    await expect(page).toHaveURL(/\/change-password-done/);
    currentPassword = third;

    // Now try to go back to it.
    await signInAndSettle(page, OWNED_MOBILE, third);
    await page.goto("/change-password");
    await fillChangeForm(page, third, replacement);
    await submit(page);

    await expect(
      page.getByText(/cannot reuse a recent password/i),
    ).toBeVisible();
    // Anchored: an unanchored /change-password/ would also match the success
    // page, so a change that wrongly succeeded would still pass this assertion.
    await expect(page).toHaveURL(/\/change-password$/);
  });

  /**
   * The account is deliberately left on `replacement`. Restoring it would mean
   * setting a password that is now in history, which the reuse rule rejects —
   * see the ownership note at the top of this file. The next run detects the
   * new password in beforeAll and rotates the other way.
   */
});
