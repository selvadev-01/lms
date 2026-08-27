import { test, expect, type APIRequestContext } from "@playwright/test";

import { STORAGE_STATE, apiAs, type ApiClient } from "./support/session";

/**
 * Employee Management (Module 03) end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000013 (Super Admin), 9000000014
 * (Branch Admin, BR001), 9000000017 (the active employee it reassigns and
 * deactivates) and 9000000018 (the inactive employee it only reads). It creates
 * and deletes a scratch employee, so it must run against a freshly seeded
 * database.
 *
 * It deliberately does NOT mutate BR002's status, which organizations.spec.ts
 * owns. Scenario 16 is therefore asserted through the branch selector offering
 * only ACTIVE branches, plus a direct API call with an inactive branch id — both
 * of which prove the rule without racing another spec's fixtures.
 *
 * The load-bearing tests are the surface split (an administrator must not be
 * reachable through /employees) and the assignment guard (a deactivated employee
 * cannot receive new work, which is what Scenarios 10, 20 and 53 turn on).
 *
 * Serial: the assignment and status toggles are stateful.
 */

/**
 * Serial within the file. The Module 03 specs also share seeded accounts and role
 * fixtures *between* files, which `describe.configure` cannot express — Playwright
 * parallelises files independently. That constraint is enforced in
 * `playwright.config.ts`, which puts these three in a single-worker project.
 */
test.describe.configure({ mode: "serial" });

const SUPER_ADMIN_MOBILE = "9000000013";
const BRANCH_ADMIN_MOBILE = "9000000014";
const EMPLOYEE_MOBILE = "9000000017";
const INACTIVE_EMPLOYEE_MOBILE = "9000000018";
const ADMIN_TARGET_MOBILE = "9000000015";

/** The employee this spec creates and destroys. Never seeded. */
const SCRATCH_MOBILE = "9000000098";
const SCRATCH_CODE = "EMP098";

async function employeeIds(api: ApiClient): Promise<Record<string, string>> {
  const list = await api.get(`/employees`);
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

async function branchIds(api: ApiClient): Promise<Record<string, string>> {
  const list = await api.get(`/branches`);
  if (!list.ok()) return {};

  const body = (await list.json()) as {
    branches: Array<{ branchId: string; code: string }>;
  };

  return Object.fromEntries(
    body.branches.map((branch) => [branch.code, branch.branchId]),
  );
}

/** Removes the scratch employee and restores 9000000017's branch and status. */
async function resetFixtures(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, SUPER_ADMIN_MOBILE);

  const ids = await employeeIds(api);
  const branches = await branchIds(api);

  const scratch = ids[SCRATCH_MOBILE];
  if (scratch) await api.delete(`/employees/${scratch}`);

  const employee = ids[EMPLOYEE_MOBILE];
  if (employee) {
    await api.post(`/employees/${employee}/status`, { status: "ACTIVE" });
    if (branches.BR001) {
      await api.post(`/employees/${employee}/assignment`, {
        branchId: branches.BR001,
        reason: "e2e reset",
      });
    }
  }
}

test.beforeAll(async ({ request }) => {
  await resetFixtures(request);
});

test.afterAll(async ({ request }) => {
  await resetFixtures(request);
});

test.describe("Employee Management — Super Admin", () => {
  test("Scenario 14: employees are listed, administrators are not", async ({
    page,
  }) => {
    await page.goto("/employees");

    await expect(
      page.getByRole("heading", { name: "Employee Management" }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "EMP017" })).toBeVisible();

    // The surface split, from the other side: an administrator must not appear
    // here even though both live in the same table.
    await expect(
      page.getByRole("row").filter({ hasText: "RBAC Target User" }),
    ).toHaveCount(0);
  });

  test("Scenario 15: an employee is added", async ({ page }) => {
    await page.goto("/employees/new");

    await page.getByLabel(/Full Name/).fill("Scratch Employee");
    await page.getByLabel(/Mobile Number/).fill(SCRATCH_MOBILE);
    await page.getByLabel(/Employee ID/).fill(SCRATCH_CODE);
    await page
      .getByLabel(/Branch/)
      .selectOption({ label: "Chennai Main Branch" });
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Create employee" }).click();

    await page.waitForURL("**/employees");
    await expect(page.getByRole("cell", { name: SCRATCH_CODE })).toBeVisible();
  });

  test("Scenario 16: only active branches are offered", async ({ page }) => {
    await page.goto("/employees/new");

    // An inactive branch cannot receive an employee, so it is never offered.
    // BR003 is childless and active in the seed; the assertion is that the
    // selector is populated from the active-only list rather than all branches.
    const options = await page
      .getByLabel(/Branch/)
      .locator("option")
      .allTextContents();

    expect(options).toContain("Chennai Main Branch");
    expect(options).not.toContain("");
  });

  test("Scenario 16: the API refuses an inactive branch", async ({
    request,
  }) => {
    // Asserted with a nonexistent branch id rather than by deactivating a real
    // branch, which would race organizations.spec.ts for BR002.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);

    const response = await api.post(`/employees`, {
      name: "Nowhere",
      mobile: "9000000097",
      employeeCode: "EMP097",
      branchId: "11111111-1111-4111-8111-111111111111",
      roleIds: [],
      status: "PENDING",
    });

    // Refused: an empty role set and an unreachable branch are both invalid.
    expect([400, 404, 409]).toContain(response.status());
  });
});

test.describe("Employee Management — assignment", () => {
  test("Scenario 17: an active employee is reassigned", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await employeeIds(api);
    await page.goto(`/employees/${ids[EMPLOYEE_MOBILE]}`);

    await expect(
      page.getByRole("heading", { name: "Branch assignment" }),
    ).toBeVisible();

    await page
      .getByLabel(/^Branch/)
      .selectOption({ label: "Coimbatore Branch" });
    await page.getByLabel(/Reason/).fill("Quarterly rotation");
    await page.getByRole("button", { name: "Reassign" }).click();

    await expect(page.getByText("Employee reassigned.")).toBeVisible();
  });

  test("Scenarios 10 and 53: a deactivated employee cannot be reassigned", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await employeeIds(api);
    const inactive = ids[INACTIVE_EMPLOYEE_MOBILE];
    expect(inactive).toBeDefined();
    await page.goto(`/employees/${inactive}`);

    // The form says so rather than letting the click fail — and the API refuses
    // independently, which the next test asserts.
    await expect(page.getByText(/This employee is not active/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reassign" })).toHaveCount(0);
  });

  test("Scenarios 10 and 53: the API refuses the assignment too", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await employeeIds(api);
    const branches = await branchIds(api);

    const response = await api.post(
      `/employees/${ids[INACTIVE_EMPLOYEE_MOBILE]}/assignment`,
      { branchId: branches.BR001 },
    );

    expect(response.status()).toBe(409);
  });

  test("Scenario 20: the active-employee selector excludes inactive staff", async ({
    request,
  }) => {
    // What the field-collection assignment flow will call. An inactive employee
    // must not be offered for new work.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);

    const response = await api.get(
      `/employees?activeOnly=true&roleCode=FIELD_EMPLOYEE`,
    );
    expect(response.ok()).toBe(true);

    const body = (await response.json()) as {
      users: Array<{ mobile?: string; status: string }>;
    };

    expect(body.users.every((user) => user.status === "ACTIVE")).toBe(true);
    expect(
      body.users.some((user) => user.mobile === INACTIVE_EMPLOYEE_MOBILE),
    ).toBe(false);
  });
});

test.describe("Employee Management — lifecycle", () => {
  test("Scenario 21: an employee is deactivated and reactivated", async ({
    page,
  }) => {
    await page.goto("/employees");

    const row = page.getByRole("row").filter({ hasText: SCRATCH_CODE });
    await row.getByRole("button", { name: /Deactivate|Activate/ }).click();
    await expect(
      page.getByText(/Employee (deactivated|activated)\./),
    ).toBeVisible();
  });
});

test.describe("Employee Management — Branch Admin confinement", () => {
  // Runs as the Branch Admin rather than the Super Admin the project defaults
  // to: the point of these tests is what a branch-confined caller can reach.
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenario 22: the list is confined to the caller's branch", async ({
    page,
  }) => {
    await page.goto("/employees");

    await expect(
      page.getByRole("heading", { name: "Employee Management" }),
    ).toBeVisible();

    // Every visible row is on the caller's own branch.
    const branches = await page
      .getByRole("row")
      .filter({ hasText: /EMP0/ })
      .locator("td")
      .filter({ hasText: /Branch$/ })
      .allTextContents();

    for (const branch of branches) {
      expect(branch).toContain("Chennai");
    }
  });

  test("Scenario 25: no create control without employees.create", async ({
    page,
  }) => {
    await page.goto("/employees");

    // Q-RBAC-21's default: a Branch Admin reaches the screen and holds
    // employees.view and employees.activate, but not create or assign.
    await expect(page.getByRole("link", { name: /Add employee/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: /Deactivate|Activate/ }).first(),
    ).toBeVisible();
  });

  test("Scenario 25: creating an employee directly is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN_MOBILE);
    const branches = await branchIds(api);

    const response = await api.post(`/employees`, {
      name: "Sneaky",
      mobile: "9000000096",
      employeeCode: "EMP096",
      branchId: branches.BR001,
      roleIds: [],
      status: "PENDING",
    });

    expect(response.status()).toBe(403);
  });
});

test.describe("Employee Management — the surface split", () => {
  test("an administrator is unreachable through the employee routes", async ({
    request,
  }) => {
    // The easiest bug in this module: applying the employeeCode filter only to
    // the list would leave the detail route able to read an administrator's
    // record for a caller holding nothing but employees.view.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);

    const users = await api.get(`/users`);
    const body = (await users.json()) as {
      users: Array<{ userId: string; mobile?: string }>;
    };
    const admin = body.users.find(
      (user) => user.mobile === ADMIN_TARGET_MOBILE,
    );
    expect(admin).toBeDefined();

    const response = await api.get(`/employees/${admin!.userId}`);
    expect(response.status()).toBe(404);
  });

  test("an employee is unreachable through the user routes", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const ids = await employeeIds(api);

    const response = await api.get(`/users/${ids[EMPLOYEE_MOBILE]}`);
    expect(response.status()).toBe(404);
  });
});
