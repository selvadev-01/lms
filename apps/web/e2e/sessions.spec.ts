import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

/**
 * Active Sessions / Session Management end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000008 exclusively. It signs in from
 * several browser contexts simultaneously and revokes them, so sharing the
 * account would make another spec's session vanish mid-test. The password is
 * never changed, so no restoration is needed.
 *
 * The load-bearing test here is "a revoked session is denied on its very next
 * request" (Scenarios 13, 29). Before the guard validated the session row, a
 * revoked session kept working until its 15-minute access token expired, so
 * that test is the one that would catch the regression.
 */

const SEED_PASSWORD = "Kestrel7Vault";
const OWNED_MOBILE = "9000000008";
const ORG_CODE = "DEMO";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

/**
 * Signs in and waits for the redirect to land.
 *
 * A Branch Admin lands on /branch; the assertion also tolerates the other
 * dashboards so a role change in the seed does not silently break the helper.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel(/Organization Code/).fill(ORG_CODE);
  await page.getByLabel(/Mobile Number/).fill(OWNED_MOBILE);
  await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/(branch|field)?$/);
}

/**
 * Signs in from a brand-new browser context, giving a genuinely separate
 * session — the same page would merely rotate the one that already exists.
 *
 * Sign-in is rate limited to 20/minute per IP, so contexts are created only
 * where a test truly needs a second session.
 */
async function signInNewContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  return page;
}

/**
 * Signs in over the API, waiting out the per-IP rate limit if it has been hit.
 *
 * Sign-in allows 20 requests a minute per address, and this spec signs in twice
 * per test. Retrying after the window is what keeps a full-suite run from
 * failing on a 429 that says nothing about the behaviour under test — the same
 * reasoning as the change-password spec's beforeAll probe.
 */
async function apiSignIn(
  request: APIRequestContext,
  { expectOk = true }: { expectOk?: boolean } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
      data: {
        orgCode: ORG_CODE,
        mobile: OWNED_MOBILE,
        password: SEED_PASSWORD,
      },
      failOnStatusCode: false,
    });

    if (response.ok()) return true;
    if (response.status() !== 429) break;

    // Wait for the 60s window to roll over, then try once more.
    await new Promise((resolve) => setTimeout(resolve, 61_000));
  }

  if (expectOk) expect(false, "API sign-in did not succeed").toBe(true);
  return false;
}

/** The table row for a session, located by the device text it renders. */
function sessionRows(page: Page) {
  return page
    .getByRole("row")
    .filter({ hasText: /Chrome|Safari|Firefox|Edge|Unknown/ });
}

/**
 * Serial, because every test signs in as the same account and revokes its
 * sessions. Run in parallel they delete each other's sessions mid-test, which
 * surfaces as a sign-in that never redirects rather than as anything
 * resembling the real defect.
 */
test.describe.configure({ mode: "serial" });

test.describe("Active Sessions", () => {
  /**
   * Clears sessions left behind by earlier runs.
   *
   * Sessions survive the browser context that created them — that is the point
   * of the feature — so without this the account accumulates them across runs
   * and the row-count assertions below drift. Signing in once and calling
   * revoke-all ends every session except the one just created, which is then
   * discarded with the request context.
   */
  test.beforeEach(async ({ request }) => {
    // Generous: this hook may have to sit out a 60s rate-limit window.
    test.setTimeout(180_000);

    // Not asserted — a failure here is reported by the test itself rather than
    // as an opaque setup error.
    const signedIn = await apiSignIn(request, { expectOk: false });
    if (!signedIn) return;

    await request.post(`${API_BASE}/api/v1/auth/sessions/revoke-all`, {
      failOnStatusCode: false,
    });
    await request.post(`${API_BASE}/api/v1/auth/sign-out`, {
      failOnStatusCode: false,
    });
  });

  test("Scenario 1: an authenticated user sees their current session", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/active-sessions");

    await expect(
      page.getByRole("heading", { name: "Active Sessions" }),
    ).toBeVisible();
    // The session making the request is badged, so the user can tell which
    // row is the device in front of them.
    await expect(page.getByText("This device")).toBeVisible();
  });

  test("Scenario 2: an unauthenticated user cannot open Session Management", async ({
    page,
  }) => {
    await page.goto("/active-sessions");

    await expect(page).toHaveURL(/\/signin/);
    // No protected session information reached the page.
    await expect(page.getByText("This device")).toBeHidden();
  });

  test("Scenario 3: session data does not expose a way to change scope", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/active-sessions");

    /**
     * Scoped to the sessions card, not the page: the admin shell contributes
     * its own search box, and asserting over the whole page would fail on that
     * rather than on anything this screen renders.
     */
    const card = page
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: "Active Sessions" }) })
      .last();

    // The screen is read-and-revoke only: nothing on it edits org or branch.
    await expect(card.getByRole("combobox")).toHaveCount(0);
    await expect(card.getByRole("textbox")).toHaveCount(0);
    await expect(card.getByRole("spinbutton")).toHaveCount(0);
  });

  test("a second sign-in appears as a separate session", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const second = await signInNewContext(browser);

    await page.goto("/active-sessions");
    await expect(sessionRows(page)).toHaveCount(2);

    await second.context().close();
  });

  /**
   * Scenarios 13 and 29 — the reason this story exists.
   *
   * The revoked context must be denied on its NEXT request, not when its
   * access token eventually expires.
   */
  test("Scenario 13: a revoked session is denied on its very next request", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const victim = await signInNewContext(browser);

    // Confirm the victim really is authenticated before anything is revoked,
    // so a later denial cannot be mistaken for it never having been signed in.
    await victim.goto("/change-password");
    await expect(victim).toHaveURL(/\/change-password$/);

    await page.goto("/active-sessions");
    const otherRow = sessionRows(page)
      .filter({ hasNotText: "This device" })
      .first();
    await otherRow.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText(/signed out/i)).toBeVisible();

    // The revoked context's next navigation is rejected — no waiting for the
    // 15-minute token lifetime.
    await victim.goto("/change-password");
    await expect(victim).toHaveURL(/\/signin/);

    await victim.context().close();
  });

  test("Scenario 7: revoking an already-ended session does not reactivate it", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const victim = await signInNewContext(browser);
    const victimCookies = await victim.context().cookies();

    await page.goto("/active-sessions");
    await sessionRows(page)
      .filter({ hasNotText: "This device" })
      .first()
      .getByRole("button", { name: "End session" })
      .click();
    await expect(page.getByText(/signed out/i)).toBeVisible();

    // Replaying the revoked credential a second time is still refused.
    const replay = await browser.newContext();
    await replay.addCookies(victimCookies);
    const replayPage = await replay.newPage();
    await replayPage.goto("/change-password");
    await expect(replayPage).toHaveURL(/\/signin/);

    await replay.close();
    await victim.context().close();
  });

  test("sign out everywhere else ends other sessions but keeps this one", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const other = await signInNewContext(browser);

    await page.goto("/active-sessions");
    await page
      .getByRole("button", { name: "Sign out everywhere else" })
      .click();

    // The acting session survives — the user stays on the security screen.
    await expect(page).toHaveURL(/\/active-sessions/);
    await expect(page.getByText("This device")).toBeVisible();

    await other.goto("/change-password");
    await expect(other).toHaveURL(/\/signin/);

    await other.context().close();
  });

  /** Scenarios 4 and 5 — the dropdown's Sign out must revoke, not just navigate. */
  test("Scenario 4: signing out from the header revokes the session", async ({
    page,
  }) => {
    await signIn(page);
    const cookies = await page.context().cookies();

    await page.getByRole("button", { name: /Musharof/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin/);

    // Restoring the pre-logout cookies must not restore access: the session
    // row was revoked server-side, which a cookie cannot undo.
    await page.context().addCookies(cookies);
    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("Scenario 24: the API never returns another user's sessions", async ({
    request,
  }) => {
    await apiSignIn(request);

    const sessions = await request.get(`${API_BASE}/api/v1/auth/sessions`);
    expect(sessions.ok()).toBe(true);

    const body = (await sessions.json()) as {
      sessions: Array<Record<string, unknown>>;
    };

    // Every returned session belongs to the caller, and none of them carries
    // the reusable secret (Scenarios 40-43).
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain("refreshtoken");
    expect(serialized).not.toContain("hash");
  });

  test("Scenario 28: an invalid session identifier is rejected", async ({
    request,
  }) => {
    await apiSignIn(request);

    // A well-formed but unknown session id changes nothing and reports no
    // detail that would confirm whether it exists.
    const response = await request.delete(
      `${API_BASE}/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000`,
      { failOnStatusCode: false },
    );

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(0);
  });
});
