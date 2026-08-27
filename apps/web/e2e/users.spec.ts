import { test, expect, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  ORG_CODE,
  SEED_PASSWORD,
  STORAGE_STATE,
  apiAs,
  type ApiClient,
} from "./support/session";

/**
 * Admin Management (Module 03) end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000013 (Super Admin), 9000000014
 * (Branch Admin, BR001), 9000000015 (the mutation target) and 9000000016
 * (BR002, read-only cross-branch target). It deactivates and reactivates
 * 9000000015 and creates and deletes a scratch account, so it must run against a
 * freshly seeded database.
 *
 * The load-bearing test is "a deactivation ends a live session immediately". It
 * is the one behaviour this module exists to add: before it, roles and
 * permissions were snapshotted into the access token at sign-in, so revoking
 * someone's access did nothing until they next signed in. A regression there
 * would not look like a broken screen — it would look like a deactivated
 * administrator continuing to work for another fifteen minutes.
 *
 * Serial: the status toggles are stateful and the scratch account is
 * destructive.
 */

/**
 * Serial within the file. The Module 03 specs also share seeded accounts and role
 * fixtures *between* files, which `describe.configure` cannot express — Playwright
 * parallelises files independently. That constraint is enforced in
 * `playwright.config.ts`, which puts these three in a single-worker project.
 */
test.describe.configure({ mode: "serial" });

const SUPER_ADMIN_MOBILE = "9000000013";
const TARGET_MOBILE = "9000000015";
const OTHER_BRANCH_MOBILE = "9000000016";

/** The account this spec creates and destroys. Never seeded. */
const SCRATCH_MOBILE = "9000000099";

/** Every user on the admin surface, keyed by mobile. */
async function userIds(api: ApiClient): Promise<Record<string, string>> {
  const list = await api.get(`/users`);
  if (!list.ok()) return {};

  const body = (await list.json()) as {
    users: Array<{ userId: string; mobile?: string }>;
  };

  return Object.fromEntries(
    body.users
      .filter((user) => user.mobile)
      .map((user) => [user.mobile as string, user.userId]),
  );
}

/** Removes the scratch account and restores the target's status. */
async function resetFixtures(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, SUPER_ADMIN_MOBILE);

  const ids = await userIds(api);

  const scratch = ids[SCRATCH_MOBILE];
  if (scratch) await api.delete(`/users/${scratch}`);

  // A failed run may have left the target deactivated, which would make every
  // subsequent sign-in as it fail for an unrelated reason.
  const target = ids[TARGET_MOBILE];
  if (target) {
    await api.post(`/users/${target}/status`, { status: "ACTIVE" });
  }
}

test.beforeAll(async ({ request }) => {
  await resetFixtures(request);
});

test.afterAll(async ({ request }) => {
  await resetFixtures(request);
});

test.describe("Admin Management — Super Admin", () => {
  test("Scenario 1: administrators are listed, employees are not", async ({
    page,
  }) => {
    await page.goto("/users");

    await expect(
      page.getByRole("heading", { name: "Admin Management" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "RBAC Target User" }),
    ).toBeVisible();

    // The surface split: an employee must not appear here even though both live
    // in the same table.
    await expect(
      page.getByRole("link", { name: "RBAC Field Employee" }),
    ).toHaveCount(0);
  });

  test("Scenario 2: an administrator is created as PENDING", async ({
    page,
  }) => {
    await page.goto("/users/new");

    await page.getByLabel(/Full Name/).fill("Scratch Admin");
    await page.getByLabel(/Mobile Number/).fill(SCRATCH_MOBILE);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Create user" }).click();

    await page.waitForURL("**/users");

    // A new account has no password, so it cannot start ACTIVE — PENDING is the
    // status that says why rather than conflating it with a deactivation.
    const row = page.getByRole("row").filter({ hasText: "Scratch Admin" });
    await expect(row.getByText("PENDING")).toBeVisible();
  });

  test("Scenario 3: a duplicate mobile number is rejected", async ({
    page,
  }) => {
    await page.goto("/users/new");

    await page.getByLabel(/Full Name/).fill("Duplicate");
    await page.getByLabel(/Mobile Number/).fill(SCRATCH_MOBILE);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/already in use/i)).toBeVisible();
  });

  test("Scenario 5: an administrator's name can be edited", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);
    await page.goto(`/users/${ids[SCRATCH_MOBILE]}`);

    await page.getByLabel(/Full Name/).fill("Scratch Admin Renamed");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("User updated.")).toBeVisible();
  });

  test("the login identifier cannot be edited", async ({ page, request }) => {
    // Changing a mobile is an identity change rather than a profile edit, so the
    // field is present but disabled and carries no name.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);

    // Asserted rather than assumed: an undefined id would navigate to
    // `/users/undefined`, which renders the *create* form — where the mobile
    // field is legitimately editable. The test would then fail claiming the
    // field is enabled, pointing at the component instead of at the missing
    // fixture.
    expect(
      ids[SCRATCH_MOBILE],
      "the scratch account should exist by now — is another spec deleting it?",
    ).toBeDefined();
    await page.goto(`/users/${ids[SCRATCH_MOBILE]}`);

    // The detail page renders the role assignment card; the create form does
    // not. Asserting it first means an unauthenticated bounce or a wrong route
    // fails here, naming the cause, rather than three lines down as "the mobile
    // field is editable" — which would read as a component bug.
    await expect(
      page.getByRole("heading", { name: "Roles & access" }),
    ).toBeVisible();
    await expect(page.getByLabel(/Mobile Number/)).toBeDisabled();
  });
});

test.describe("Admin Management — live authorization", () => {
  test("Scenarios 9 and 45: a deactivation ends a live session immediately", async ({
    browser,
    request,
  }) => {
    // The behaviour this whole module exists to add. Two independent browser
    // contexts: one signed in as the target, one as the administrator who
    // deactivates them. The target's session is never touched directly — only
    // their account status changes — and their very next request must fail.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);
    const targetId = ids[TARGET_MOBILE];
    expect(targetId).toBeDefined();

    // The target's own saved session, so the context is authenticated as them
    // rather than as the administrator this project defaults to.
    const targetContext = await browser.newContext({
      storageState: STORAGE_STATE.target,
    });
    const targetPage = await targetContext.newPage();

    try {
      // Working normally on an unexpired token.
      await targetPage.goto("/branches");
      await expect(
        targetPage.getByRole("heading", { name: "Branch Management" }),
      ).toBeVisible();

      const deactivate = await api.post(`/users/${targetId}/status`, {
        status: "INACTIVE",
        reason: "e2e live enforcement",
      });
      expect(deactivate.ok()).toBe(true);

      // The same token, the same browser, no reload of the session: the next
      // request is refused because authorization is re-resolved per request.
      await targetPage.goto("/branches");
      await expect(targetPage).toHaveURL(/\/signin/);
    } finally {
      await targetContext.close();
    }
  });

  test("Scenario 9: a deactivated account cannot sign in", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel(/Organization Code/).fill(ORG_CODE);
    await page.getByLabel(/Mobile Number/).fill(TARGET_MOBILE);
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/signin/);
  });

  test("Scenario 12: reactivation restores access", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);
    await page.goto("/users");

    const row = page.getByRole("row").filter({ hasText: "RBAC Target User" });
    await row.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Account activated.")).toBeVisible();

    // And the account can authenticate again. Sent through the raw request
    // fixture rather than the authenticated client: this is a fresh sign-in
    // being tested, so carrying an existing session would prove nothing.
    const signedIn = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
      data: {
        orgCode: ORG_CODE,
        mobile: TARGET_MOBILE,
        password: SEED_PASSWORD,
      },
    });
    expect(signedIn.ok()).toBe(true);
    expect(ids[TARGET_MOBILE]).toBeDefined();
  });
});

test.describe("Admin Management — branch confinement", () => {
  // Acts as the Branch Admin rather than the Super Admin the project defaults
  // to: the point of these tests is what a branch-confined caller can reach.
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenario 23: a Branch Admin cannot reach another branch's user", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);
    const otherBranchUser = ids[OTHER_BRANCH_MOBILE];
    expect(otherBranchUser).toBeDefined();

    // Branch scope is an authorization boundary, not a list filter: the record
    // is unreachable by direct URL too. It renders the app's 404 rather than a
    // "forbidden" — out-of-scope and absent must be indistinguishable, or the
    // response becomes an oracle for which user ids exist.
    await page.goto(`/users/${otherBranchUser}`);
    await expect(page.getByText(/can’t seem to find the page/i)).toBeVisible();
  });

  test("Scenario 23: the list is confined to the caller's branch", async ({
    page,
  }) => {
    await page.goto("/users");

    await expect(
      page.getByRole("row").filter({ hasText: "RBAC Other Branch User" }),
    ).toHaveCount(0);
  });
});

test.describe("Admin Management — lockout guards", () => {
  test("an administrator cannot deactivate their own account", async ({
    request,
  }) => {
    // One click should not be able to lock someone out of the system they are
    // administering.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);

    const response = await api.post(
      `/users/${ids[SUPER_ADMIN_MOBILE]}/status`,
      { status: "INACTIVE" },
    );

    expect(response.status()).toBe(409);
  });
});

test.describe("Admin Management — deletion", () => {
  test("Scenario 54: deleting a user with history is blocked and says why", async ({
    page,
  }) => {
    await page.goto("/users");

    // 9000000015 has signed in during this suite, so audit rows reference it and
    // it is permanently undeletable — Rules 14 and 43 working as intended.
    const row = page.getByRole("row").filter({ hasText: "RBAC Target User" });
    await row.getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("button", { name: "Delete", exact: true })
      .last()
      .click();

    await expect(page.getByText(/Deactivate this user instead/i)).toBeVisible();
    await expect(page.getByText(/audit records/i)).toBeVisible();
  });

  test("Scenario 54: an unused account can be deleted", async ({ request }) => {
    // The scratch account was created by this suite and never signed in, so
    // nothing references it. This is the case the delete path exists for, and
    // the counterpart to the test above: the guard distinguishes an account with
    // history from one without, rather than refusing every delete.
    //
    // Asserted through the API rather than the UI. Sign-in is rate limited to
    // 20/minute and this spec is at its budget by now; the list rendering is
    // already covered by the tests above, so a second browser sign-in here would
    // buy nothing but flake.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await userIds(api);
    expect(ids[SCRATCH_MOBILE]).toBeDefined();

    const response = await api.delete(`/users/${ids[SCRATCH_MOBILE]}`);
    expect(response.status()).toBe(200);

    const after = await userIds(api);
    expect(after[SCRATCH_MOBILE]).toBeUndefined();
  });
});
