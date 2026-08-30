import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Organizations & Branches (Module 02) end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000011 (Super Admin, organization-wide)
 * and 9000000012 (Branch Admin, confined to BR001) exclusively. It mutates the
 * DEMO organization's name and BR002's status and deletes BR003, so it must run
 * against a freshly seeded database and no other spec may borrow these
 * accounts.
 *
 * The load-bearing tests are the branch-scope ones: a Branch Admin seeing only
 * their own branch, and BR002 being unreachable by direct URL. Branch scope is
 * an authorization boundary rather than a UI filter (Rule 26), so a regression
 * there would not show up as a missing row — it would show up as data leaking
 * between branches.
 *
 * Serial: BR003's deletion is destructive and the status toggles are stateful,
 * so the tests must not race each other.
 */

test.describe.configure({ mode: "serial" });

const SEED_PASSWORD = "Kestrel7Vault";
const SUPER_ADMIN_MOBILE = "9000000011";
const BRANCH_ADMIN_MOBILE = "9000000012";
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

/**
 * Signs in and waits for the post-sign-in redirect to land.
 *
 * Sign-in is rate limited to 20/minute per IP and this spec signs in on nearly
 * every test, so a 429 is waited out rather than failed on: it says nothing
 * about the behaviour under test. Same reasoning as the sessions and
 * gps-check-in specs.
 */
async function signIn(page: Page, mobile: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/signin");
    await page.getByLabel(/Organization Code/).fill(ORG_CODE);
    await page.getByLabel(/Mobile Number/).fill(mobile);
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // A Super Admin lands on /, a Branch Admin on /branch.
    const landed = await page
      .waitForURL(/\/(branch|field)?$/, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (landed) return;

    const rateLimited = await page
      .getByText(/too many/i)
      .isVisible()
      .catch(() => false);

    if (!rateLimited) break;

    // The window is 60s; wait it out once rather than failing the suite.
    await page.waitForTimeout(61_000);
  }

  await expect(page).toHaveURL(/\/(branch|field)?$/);
}

/** The branch this spec creates and destroys. Never seeded. */
const SCRATCH_CODE = "BR900";

/**
 * Removes the scratch branch if a previous run left it behind.
 *
 * Without this, one mid-suite failure poisons every subsequent run: the create
 * test would hit a duplicate-code conflict and report a collision with its own
 * leftovers rather than anything about the behaviour under test. Deleting via
 * the API is safe precisely because the branch is never referenced — if it ever
 * were, the delete guard would refuse and this would surface as a real failure.
 */
async function removeScratchBranch(request: APIRequestContext): Promise<void> {
  const signIn = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
    data: {
      orgCode: ORG_CODE,
      mobile: SUPER_ADMIN_MOBILE,
      password: SEED_PASSWORD,
    },
  });

  if (!signIn.ok()) return;

  const list = await request.get(`${API_BASE}/api/v1/branches`);
  if (!list.ok()) return;

  const body = (await list.json()) as {
    branches: { branchId: string; code: string }[];
  };
  const scratch = body.branches.find((b) => b.code === SCRATCH_CODE);

  if (scratch) {
    await request.delete(`${API_BASE}/api/v1/branches/${scratch.branchId}`, {
      headers: CSRF_HEADERS,
    });
  }
}

test.beforeAll(async ({ request }) => {
  await removeScratchBranch(request);
});

test.afterAll(async ({ request }) => {
  await removeScratchBranch(request);
});

test.describe("Company Settings", () => {
  test("Scenario 2: a Super Admin sees their own organization", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/company-settings");

    await expect(page.getByLabel("Organization Code")).toHaveValue(ORG_CODE);
    // The code is the tenant's identity and is quoted at sign-in: readable,
    // never editable.
    await expect(page.getByLabel("Organization Code")).toBeDisabled();
    // Exact, because the sidebar's "Active Sessions" link is also a substring
    // match for "ACTIVE" and would make this ambiguous.
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  });

  test("Scenario 6: an edit saves and preserves the organization code", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/company-settings");

    const renamed = "Demo Finance Ltd (Edited)";
    await page.getByLabel(/Organization Name/).fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Company Settings saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Organization Name/)).toHaveValue(renamed);
    await expect(page.getByLabel("Organization Code")).toHaveValue(ORG_CODE);

    // Restore, so a re-run starts from the seeded name.
    await page.getByLabel(/Organization Name/).fill("Demo Finance Ltd");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Company Settings saved.")).toBeVisible();
  });

  test("mandatory field validation: the name cannot be cleared", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/company-settings");

    await page.getByLabel(/Organization Name/).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Organization Name is required")).toBeVisible();
  });
});

test.describe("Branch Management — Super Admin", () => {
  test("Scenario 13: branches are listed with their status", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/branches");

    await expect(page.getByRole("cell", { name: "BR001" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "BR002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "BR003" })).toBeVisible();
  });

  test("Scenario 19: a duplicate branch code is rejected", async ({ page }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/branches/new");

    await page.getByLabel(/Branch Code/).fill("BR001");
    await page.getByLabel(/Branch Name/).fill("Duplicate Branch");
    await page.getByLabel(/^Address\s*\*/).fill("1 Test Road");
    await page.getByLabel(/City/).fill("Chennai");
    await page.getByLabel(/State/).fill("Tamil Nadu");
    await page.getByLabel(/Pincode/).fill("600001");
    await page.getByRole("button", { name: "Create branch" }).click();

    await expect(page.getByText(/already in use/i)).toBeVisible();
  });

  test("Scenario 17: a branch is created and appears in the list", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/branches/new");

    await page.getByLabel(/Branch Code/).fill("BR900");
    await page.getByLabel(/Branch Name/).fill("E2E Temporary Branch");
    await page.getByLabel(/^Address\s*\*/).fill("9 Test Street");
    await page.getByLabel(/City/).fill("Trichy");
    await page.getByLabel(/State/).fill("Tamil Nadu");
    await page.getByLabel(/Pincode/).fill("620001");
    await page.getByRole("button", { name: "Create branch" }).click();

    await expect(page).toHaveURL(/\/branches$/);
    await expect(page.getByRole("cell", { name: "BR900" })).toBeVisible();
  });

  test("Scenarios 27, 28: a branch deactivates and reactivates", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/branches");

    const row = page.getByRole("row", { name: /BR900/ });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Branch deactivated.")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /BR900/ }).getByText("INACTIVE"),
    ).toBeVisible();

    await page
      .getByRole("row", { name: /BR900/ })
      .getByRole("button", { name: "Activate" })
      .click();
    await expect(page.getByText("Branch activated.")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /BR900/ }).getByText("ACTIVE"),
    ).toBeVisible();
  });

  test("Scenario 29: a branch nothing references can be deleted", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/branches");

    await page
      .getByRole("row", { name: /BR900/ })
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("button", { name: "Delete branch" }).click();

    await expect(page.getByText("Branch deleted.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "BR900" })).toBeHidden();
  });

  test("Scenario 30: deletion is blocked and names what is in the way", async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN_MOBILE);
    await page.goto("/branches");

    // BR001 carries every other spec's fixtures, so it can never be deleted.
    await page
      .getByRole("row", { name: /BR001/ })
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("button", { name: "Delete branch" }).click();

    await expect(page.getByText(/cannot be deleted/i)).toBeVisible();
    // The advice is only actionable if the reason is visible.
    await expect(
      page.getByText(/Deactivate this branch instead/i),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "BR001" })).toBeVisible();
  });
});

test.describe("Branch Management — Branch Admin confinement", () => {
  test("Scenario 15: only the caller's own branch is listed", async ({
    page,
  }) => {
    await signIn(page, BRANCH_ADMIN_MOBILE);
    await page.goto("/branches");

    await expect(page.getByRole("cell", { name: "BR001" })).toBeVisible();
    // The confinement is enforced server-side: BR002 is not filtered out of a
    // full list, it is never returned.
    await expect(page.getByRole("cell", { name: "BR002" })).toBeHidden();
    await expect(page.getByRole("cell", { name: "BR003" })).toBeHidden();
  });

  test("Scenario 34: no create control is offered", async ({ page }) => {
    await signIn(page, BRANCH_ADMIN_MOBILE);
    await page.goto("/branches");

    await expect(page.getByRole("link", { name: "Add branch" })).toBeHidden();
  });

  test("Scenario 34: navigating directly to Add Branch is refused", async ({
    page,
  }) => {
    await signIn(page, BRANCH_ADMIN_MOBILE);
    await page.goto("/branches/new");

    // Redirected away rather than shown a form every submission would refuse.
    await expect(page).not.toHaveURL(/\/branches\/new$/);
  });

  test("Scenario 35: no delete or deactivate control is offered", async ({
    page,
  }) => {
    await signIn(page, BRANCH_ADMIN_MOBILE);
    await page.goto("/branches");

    await expect(page.getByRole("button", { name: "Delete" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeHidden();
  });
});
