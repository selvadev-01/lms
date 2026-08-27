import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Password-recovery end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`) and SMS_PROVIDER=console, which is the
 * default.
 *
 * The OTP is argon2-hashed at rest, so it cannot be read back from the
 * database. ConsoleSmsProvider writes each message to a local file and this
 * suite reads the code from there — the same path the provider exports.
 */

const ORG_CODE = "DEMO";
const SUPER_ADMIN_MOBILE = "9000000001";
const SEED_PASSWORD = "Kestrel7Vault";
const NEW_PASSWORD = "Recovered4Harbor";

/**
 * The happy path owns a mobile number no other spec touches.
 *
 * Issuing a recovery request cancels every earlier one for that user
 * (Q-REC-8), so two workers recovering the same account would invalidate each
 * other's code — a correct behaviour that would otherwise read as a flaky test.
 */
const RECOVERY_MOBILE = "9000000004";

/**
 * The policy specs own their own accounts for the same reason: each completes a
 * reset, and sharing an account across specs would let one cancel another's
 * live recovery request.
 */
// Dedicated seed fixtures (9000000021/22), not borrowed accounts. These
// previously pointed at 9000000002 and 9000000003, which `gps-check-in.spec.ts`
// and `auth.spec.ts` sign in to with the seed password — and this spec leaves
// them on POLICY_TEST_PASSWORD, so whichever ran second got a 401 that read as
// an authentication bug rather than as this spec having moved the password.
const POLICY_MOBILE = "9000000021";
const HISTORY_MOBILE = "9000000022";

/** Compliant, and distinct from SEED_PASSWORD so history does not reject it. */
const POLICY_TEST_PASSWORD = "Marigold4Ledger";

const DEV_SMS_LOG = resolve(__dirname, "../../api/.dev-sms.log");

/**
 * The form's own error region. Scoped away from Next's injected
 * `__next-route-announcer__`, which also carries role="alert".
 */
function formAlert(page: Page) {
  return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
}

/** Every message delivered to a mobile number so far, oldest first. */
async function deliveriesTo(mobile: string): Promise<string[]> {
  try {
    return (await readFile(DEV_SMS_LOG, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"))
      .filter(([, to]) => to === mobile)
      .map(([, , body]) => body);
  } catch {
    // File not created yet on a clean checkout.
    return [];
  }
}

/**
 * Waits for a code delivered *after* `alreadySeen` messages were on record.
 *
 * Counting prior deliveries rather than comparing timestamps: the sink stamps
 * UTC while the test clock is local, and a code that arrives within the same
 * second as the request would otherwise be ambiguous. The count is exact.
 *
 * Polling is still required because delivery happens after the request
 * transaction commits, so the redirect can land before the file is written.
 */
async function otpAfter(mobile: string, alreadySeen: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const delivered = await deliveriesTo(mobile);
    if (delivered.length > alreadySeen) {
      const match = /(\d{6})/.exec(delivered.at(-1) ?? "");
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No recovery code was delivered to ${mobile}`);
}

async function requestCode(page: Page, mobile: string, orgCode = ORG_CODE) {
  await page.goto("/forgot-password");
  await page.getByLabel(/Organization Code/).fill(orgCode);
  await page.getByLabel(/Mobile Number/).fill(mobile);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
}

async function signIn(page: Page, mobile: string, password: string) {
  await page.goto("/signin");
  await page.getByLabel(/Organization Code/).fill(ORG_CODE);
  await page.getByLabel(/Mobile Number/).fill(mobile);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// --- Navigation --------------------------------------------------------------

// Scenario 1: Forgot Password is reachable from Sign In and asks for no password.
test("Forgot Password is reached from Sign In and requests no password", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("link", { name: /Forgot password/ }).click();

  await expect(page).toHaveURL(/\/forgot-password/);
  await expect(page.getByLabel(/Mobile Number/)).toBeVisible();
  await expect(page.getByLabel(/^Password/)).toHaveCount(0);
});

// Scenario 27: recovery does not require an authenticated session.
test("Forgot Password is reachable without signing in", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("heading", { name: "Forgot Password" }),
  ).toBeVisible();
});

// Scenario 2
test("Back to Sign In returns without submitting the form", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByRole("link", { name: /Back to sign in/ }).click();
  await expect(page).toHaveURL(/\/signin/);
});

// --- Validation --------------------------------------------------------------

// Scenario 4
test("the mobile number is mandatory", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel(/Organization Code/).fill(ORG_CODE);
  await page.getByRole("button", { name: "Send code", exact: true }).click();

  await expect(page.getByText("Mobile Number is required")).toBeVisible();
  await expect(page).toHaveURL(/\/forgot-password/);
});

// Scenario 5
test("an invalid mobile number format is rejected", async ({ page }) => {
  await requestCode(page, "12345");

  await expect(
    page.getByText("Enter a valid 10-digit mobile number"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

// Scenario 6: whitespace-only reads as missing, not as a format error.
test("a whitespace-only mobile number is treated as missing", async ({
  page,
}) => {
  await requestCode(page, "   ");

  await expect(page.getByText("Mobile Number is required")).toBeVisible();
});

// --- Non-disclosure ----------------------------------------------------------

/**
 * Scenarios 8 and 22: the whole point of the flow. An unregistered mobile must
 * reach exactly the same screen as a registered one, or the form becomes an
 * account-enumeration oracle.
 */
test("an unknown mobile number reaches the same screen as a known one", async ({
  page,
}) => {
  await requestCode(page, "9111111111");
  await expect(page).toHaveURL(/\/forgot-password\/verify/);
  const unknownHeading = await page
    .getByRole("heading", { level: 1 })
    .textContent();

  await requestCode(page, SUPER_ADMIN_MOBILE);
  await expect(page).toHaveURL(/\/forgot-password\/verify/);
  const knownHeading = await page
    .getByRole("heading", { level: 1 })
    .textContent();

  // Neither request is redeemed, so this does not contend with the happy path.

  expect(unknownHeading).toBe(knownHeading);
});

test("no code is delivered for an unknown mobile number", async ({ page }) => {
  const seen = (await deliveriesTo("9111111111")).length;
  await requestCode(page, "9111111111");
  await expect(page).toHaveURL(/\/forgot-password\/verify/);

  await expect(otpAfter("9111111111", seen)).rejects.toThrow(
    /No recovery code/,
  );
});

// --- Recovery authorization --------------------------------------------------

// Scenario 16: an unverified request cannot reach Reset Password.
test("Reset Password is unreachable without a verified recovery", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/forgot-password/);
});

test("a wrong verification code is rejected generically", async ({ page }) => {
  await requestCode(page, SUPER_ADMIN_MOBILE);
  await expect(page).toHaveURL(/\/forgot-password\/verify/);

  await page.getByLabel(/Verification Code/).fill("000000");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();

  await expect(formAlert(page)).toContainText(
    "Invalid or expired verification code",
  );
});

// --- Password policy ---------------------------------------------------------

/**
 * Reset Password Scenarios 10-13. The password is rejected, but the recovery
 * authorization survives: the user corrects the password on the same screen
 * rather than being sent back through the whole SMS flow.
 *
 * Runs against the Branch Admin so it cannot disturb the serial suite below,
 * which owns the Field Employee's password.
 */
test("a password failing the policy is rejected but stays retryable", async ({
  page,
}) => {
  const seen = (await deliveriesTo(POLICY_MOBILE)).length;
  await requestCode(page, POLICY_MOBILE);
  await expect(page).toHaveURL(/\/forgot-password\/verify/);

  const otp = await otpAfter(POLICY_MOBILE, seen);
  await page.getByLabel(/Verification Code/).fill(otp);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page).toHaveURL(/\/reset-password$/);

  // Long enough, but only one character class.
  await page.getByLabel(/New Password/).fill("abcdefghijklmnop");
  await page.getByLabel(/Confirm Password/).fill("abcdefghijklmnop");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();

  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByText(/at least 3 of/i)).toBeVisible();

  /**
   * The same page and the same token now accept a compliant password, proving
   * the rejection did not consume the authorization.
   *
   * It must differ from the seed password: history rejects reuse of the
   * account's current credential, which is exactly Scenario 12.
   */
  await page.getByLabel(/New Password/).fill(POLICY_TEST_PASSWORD);
  await page.getByLabel(/Confirm Password/).fill(POLICY_TEST_PASSWORD);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();

  await expect(page).toHaveURL(/\/reset-password\/done/);

  // And the new credential actually authenticates: Branch Admin A lands on the
  // branch dashboard.
  await signIn(page, POLICY_MOBILE, POLICY_TEST_PASSWORD);
  await expect(page).toHaveURL(/\/branch/);
});

/** Scenario 12: the account's current password cannot be set again. */
test("a recently used password is rejected", async ({ page }) => {
  const seen = (await deliveriesTo(HISTORY_MOBILE)).length;
  await requestCode(page, HISTORY_MOBILE);
  await expect(page).toHaveURL(/\/forgot-password\/verify/);

  const otp = await otpAfter(HISTORY_MOBILE, seen);
  await page.getByLabel(/Verification Code/).fill(otp);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel(/New Password/).fill(SEED_PASSWORD);
  await page.getByLabel(/Confirm Password/).fill(SEED_PASSWORD);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();

  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByText(/cannot reuse a recent password/i)).toBeVisible();
});

// --- Happy path --------------------------------------------------------------

/**
 * The full chain: request, verify, reset, then prove the credential actually
 * changed (Scenario 42). Runs serially against the seeded Super Admin and
 * restores the seed password at the end so the sign-in suite is unaffected.
 */
test.describe.serial("full recovery", () => {
  test("recovers access and replaces the password", async ({ page }) => {
    const seen = (await deliveriesTo(RECOVERY_MOBILE)).length;
    await requestCode(page, RECOVERY_MOBILE);
    await expect(page).toHaveURL(/\/forgot-password\/verify/);

    const otp = await otpAfter(RECOVERY_MOBILE, seen);
    await page.getByLabel(/Verification Code/).fill(otp);
    await page
      .getByRole("button", { name: "Verify code", exact: true })
      .click();

    await expect(page).toHaveURL(/\/reset-password$/);

    await page.getByLabel(/New Password/).fill(NEW_PASSWORD);
    await page.getByLabel(/Confirm Password/).fill(NEW_PASSWORD);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();

    await expect(page).toHaveURL(/\/reset-password\/done/);

    // Scenario 28: recovery grants no access; the user must authenticate again.
    await page.goto("/");
    await expect(page).toHaveURL(/\/signin/);

    // The old password no longer works.
    await signIn(page, RECOVERY_MOBILE, SEED_PASSWORD);
    await expect(formAlert(page)).toContainText("Invalid credentials");

    // The new one does.
    await signIn(page, RECOVERY_MOBILE, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/field/);
  });

  test("restores the seed password for the remaining suites", async ({
    page,
  }) => {
    const seen = (await deliveriesTo(RECOVERY_MOBILE)).length;
    await requestCode(page, RECOVERY_MOBILE);
    // Wait for the redirect before polling, so the request has definitely
    // reached the API rather than still being in flight.
    await expect(page).toHaveURL(/\/forgot-password\/verify/);

    const otp = await otpAfter(RECOVERY_MOBILE, seen);

    await page.getByLabel(/Verification Code/).fill(otp);
    await page
      .getByRole("button", { name: "Verify code", exact: true })
      .click();

    await page.getByLabel(/New Password/).fill(SEED_PASSWORD);
    await page.getByLabel(/Confirm Password/).fill(SEED_PASSWORD);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();

    await expect(page).toHaveURL(/\/reset-password\/done/);
  });
});
