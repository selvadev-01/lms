import { test, expect, type Page } from "@playwright/test";

/**
 * Field Employee GPS Check-in end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000009 (active Field Employee) and
 * 9000000010 (inactive Field Employee) exclusively. It creates check-in rows
 * and revokes sessions, so sharing either account would make another spec's
 * state shift underneath it. Neither password is changed, so no restoration is
 * needed.
 *
 * The load-bearing tests are "an unverified employee cannot reach field
 * operations" (Scenario 5) and "a denied permission never verifies"
 * (Scenario 7). Together they are what would catch a regression that let the
 * fail-closed rule slip.
 *
 * Serial, because a verified check-in persists for 12 hours: a test that
 * verifies changes what the next test sees. Order is deliberate — the
 * unverified-gate tests run before anything checks in successfully.
 */

test.describe.configure({ mode: "serial" });

const SEED_PASSWORD = "Kestrel7Vault";
const OWNED_MOBILE = "9000000009";
const INACTIVE_MOBILE = "9000000010";
const ADMIN_MOBILE = "9000000002";
const ORG_CODE = "DEMO";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

/**
 * The API's CSRF guard refuses a mutating request without these — with 403,
 * before the handler runs, which a test asserting some other outcome would read
 * as the endpoint's own answer.
 */
const CSRF_HEADERS = {
  Origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  "X-LMS-Request": "1",
};

/** Chennai — the seeded Branch A city, so the fixture reads plausibly. */
const CHENNAI = { latitude: 13.0827, longitude: 80.2707 };

/**
 * Signs in and waits for the post-sign-in redirect to settle.
 *
 * Waiting matters here more than in the other specs: a Field Employee lands on
 * `/field`, which immediately redirects again to `/field/check-in` when there
 * is no verified check-in. Returning before that second hop lands would let a
 * following `goto` interrupt an in-flight navigation and leave the test on the
 * sign-in page.
 */
async function signIn(
  page: Page,
  mobile: string = OWNED_MOBILE,
): Promise<void> {
  await submitSignIn(page, mobile);

  // Sign-in is capped at 20 requests a minute per IP, and a full-suite run
  // shares that budget across every spec. A 429 says nothing about the
  // behaviour under test, so wait out the window and try once more — the same
  // approach the sessions and change-password specs take.
  if (await page.getByText(/temporarily unavailable/i).isVisible()) {
    // Longer than the default 30s per-test timeout, so the waiting test must
    // buy itself room before sleeping out the window.
    test.setTimeout(120_000);
    await page.waitForTimeout(61_000);
    await submitSignIn(page, mobile);
  }

  await expect(page).not.toHaveURL(/\/signin/);
}

async function submitSignIn(page: Page, mobile: string): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel(/Organization Code/).fill(ORG_CODE);
  await page.getByLabel(/Mobile Number/).fill(mobile);
  await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Settle on either the redirect or the error before the caller inspects it.
  await page
    .waitForURL((url) => !url.pathname.startsWith("/signin"), {
      timeout: 5_000,
    })
    .catch(() => {});
}

/** Scoped away from Next's route announcer, which is also role="alert". */
function formAlert(page: Page) {
  return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
}

function verifyButton(page: Page) {
  return page.getByRole("button", {
    name: /Verify my location|Check location again/,
  });
}

test.describe("GPS Check-in", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: CHENNAI,
  });

  test("Scenario 2: an unauthenticated user cannot open GPS Check-in", async ({
    page,
  }) => {
    await page.goto("/field/check-in");

    await expect(page).toHaveURL(/\/signin/);
  });

  test("Scenario 5: an unverified field employee is sent to check in", async ({
    page,
  }) => {
    await signIn(page);

    // Signing in lands on /field, which has no verified check-in yet and must
    // redirect rather than showing field operations.
    await expect(page).toHaveURL(/\/field\/check-in$/);
    // Level 3 specifically: the breadcrumb renders the same text as an h2.
    await expect(
      page.getByRole("heading", { name: "GPS Check-in", level: 3 }),
    ).toBeVisible();
  });

  test("Scenario 7: a denied location permission never verifies", async ({
    page,
    context,
  }) => {
    await signIn(page);
    await page.goto("/field/check-in");

    await context.clearPermissions();
    await verifyButton(page).click();

    await expect(formAlert(page)).toContainText(
      /Location permission is blocked/i,
    );
    await expect(formAlert(page)).not.toContainText(/Location verified/i);

    // Still gated: a failed attempt must not unlock field operations.
    await page.goto("/field");
    await expect(page).toHaveURL(/\/field\/check-in$/);
  });

  test("Scenario 13: a failed attempt can be retried from the same screen", async ({
    page,
    context,
  }) => {
    await signIn(page);
    await page.goto("/field/check-in");

    await context.clearPermissions();
    await verifyButton(page).click();
    await expect(formAlert(page)).toContainText(/permission is blocked/i);

    // The retry control is the same button, relabelled — the user is not sent
    // anywhere to try again.
    await expect(
      page.getByRole("button", { name: "Check location again" }),
    ).toBeVisible();
  });

  test("Scenarios 4, 15: a granted location verifies, after an earlier failure", async ({
    page,
    context,
  }) => {
    await signIn(page);
    await page.goto("/field/check-in");

    await context.clearPermissions();
    await verifyButton(page).click();
    await expect(formAlert(page)).toContainText(/permission is blocked/i);

    await context.grantPermissions(["geolocation"]);
    await page.getByRole("button", { name: "Check location again" }).click();

    await expect(formAlert(page)).toContainText(/Location verified/i);
  });

  test("Scenario 5: a verified check-in unlocks field operations", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/field/check-in");

    await verifyButton(page).click();
    await expect(formAlert(page)).toContainText(/Location verified/i);

    await page
      .getByRole("button", { name: /Continue to field operations/ })
      .click();

    await expect(page).toHaveURL(/\/field$/);
    await expect(page.getByText(/Location verified/i)).toBeVisible();
  });

  test("Scenario 24: verifying does not change the employee's branch", async ({
    page,
    context,
  }) => {
    // Coimbatore is Branch B's city; this employee belongs to Branch A. A
    // location near another branch must not reassign them.
    await context.setGeolocation({ latitude: 11.0168, longitude: 76.9558 });

    await signIn(page);
    await page.goto("/field/check-in");
    await verifyButton(page).click();
    await expect(formAlert(page)).toContainText(/Location verified/i);

    const response = await page.request.get(
      `${API_BASE}/api/v1/field/check-in/status`,
    );
    const body = (await response.json()) as {
      checkIn: { branchId: string } | null;
    };

    // Branch A, from the seeded user — not a branch derived from the position.
    const me = await page.request.get(`${API_BASE}/api/v1/auth/me`);
    const user = (await me.json()) as { user: { branchId: string } };

    expect(body.checkIn?.branchId).toBe(user.user.branchId);
  });

  test("Scenario 18: an offline device is shown Offline Mode, not a check-in", async ({
    page,
    context,
  }) => {
    await signIn(page);
    await page.goto("/field/check-in");
    await expect(verifyButton(page)).toBeVisible();

    await context.setOffline(true);
    // The panel listens for the offline event, so no reload is needed — and a
    // reload would fail anyway, since the page itself is served over the
    // network.
    await expect(
      page.getByRole("heading", { name: "Offline Mode" }),
    ).toBeVisible();
    await expect(page.getByText(/You are offline/i)).toBeVisible();
    await expect(page.getByText(/Cached data is not available/i)).toBeVisible();

    // Offline Mode is not a successful verification, so it offers no way on.
    await expect(verifyButton(page)).toHaveCount(0);

    await context.setOffline(false);
  });

  test("Scenarios 3, 30: a Branch Admin cannot perform a field check-in", async ({
    page,
  }) => {
    await signIn(page, ADMIN_MOBILE);
    await expect(page).toHaveURL(/\/branch$/);

    const response = await page.request.post(
      `${API_BASE}/api/v1/field/check-in`,
      {
        headers: CSRF_HEADERS,
        data: {
          clientAttemptId: "3f8b1c2e-4d5a-4b6c-8d7e-9f0a1b2c3e01",
          latitude: CHENNAI.latitude,
          longitude: CHENNAI.longitude,
          accuracyMeters: 10,
          locationTimestamp: new Date().toISOString(),
          permissionStatus: "GRANTED",
          networkStatus: "ONLINE",
        },
        failOnStatusCode: false,
      },
    );

    expect(response.status()).toBe(403);
  });

  test("Scenario 28: an inactive field employee cannot start a field session", async ({
    page,
  }) => {
    // submitSignIn rather than signIn(): the latter asserts the redirect away
    // from /signin, and the whole point here is that this account never gets
    // one.
    await submitSignIn(page, INACTIVE_MOBILE);

    // Refused at authentication — an inactive account never reaches the point
    // where a check-in could be attempted.
    await expect(formAlert(page)).toContainText(/Invalid credentials/i);
    await expect(page).toHaveURL(/\/signin/);
  });

  test("Scenario 33: check-in history records failures alongside successes", async ({
    page,
  }) => {
    await signIn(page);

    const response = await page.request.get(
      `${API_BASE}/api/v1/field/check-in/history`,
    );
    const body = (await response.json()) as {
      checkIns: Array<{ verificationStatus: string; latitude: number | null }>;
    };

    // Earlier tests produced both outcomes; neither is overwritten by the other.
    expect(body.checkIns.some((c) => c.verificationStatus === "VERIFIED")).toBe(
      true,
    );
    expect(body.checkIns.some((c) => c.verificationStatus === "FAILED")).toBe(
      true,
    );
  });
});
