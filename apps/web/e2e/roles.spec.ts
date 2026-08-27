import { test, expect, type APIRequestContext } from "@playwright/test";

import { STORAGE_STATE, apiAs } from "./support/session";

/**
 * Role & Permission Management (Module 03) end-to-end coverage.
 *
 * Requires the API running on API_BASE_URL with the development seed applied
 * (`pnpm --filter @lms/api db:seed`).
 *
 * ACCOUNT OWNERSHIP: this spec owns 9000000013 (Super Admin, organization-wide)
 * and 9000000014 (Branch Admin, confined to BR001) exclusively, shared with
 * users.spec.ts and employees.spec.ts which use them read-only for role data. It
 * mutates RBAC_DRAFT_ROLE's status and permissions and creates and deletes a
 * scratch role, so it must run against a freshly seeded database.
 *
 * The load-bearing tests are the two that cannot be seen from the happy path:
 * system-role protection, without which an organization can deactivate
 * SUPER_ADMIN and lock every administrator out permanently; and the delegation
 * subset rule, without which `roles.create` is silently equivalent to every
 * permission in the system.
 *
 * Serial: the role fixtures are stateful and the scratch role is destructive.
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

/** The role this spec creates and destroys. Never seeded. */
const SCRATCH_CODE = "RBAC_SCRATCH";

/**
 * Removes the scratch role if a previous run left it behind.
 *
 * Without this, one mid-suite failure poisons every subsequent run: the create
 * test would report a duplicate-code conflict with its own leftovers rather than
 * anything about the behaviour under test.
 */
async function removeScratchRole(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, SUPER_ADMIN_MOBILE);

  const list = await api.get(`/roles`);
  if (!list.ok()) return;

  const body = (await list.json()) as {
    roles: Array<{ roleId: string; code: string }>;
  };
  const scratch = body.roles.find((role) => role.code === SCRATCH_CODE);
  if (!scratch) return;

  await api.delete(`/roles/${scratch.roleId}`);
}

test.beforeAll(async ({ request }) => {
  await removeScratchRole(request);
});

test.afterAll(async ({ request }) => {
  await removeScratchRole(request);
});

test.describe("Role & Permission Management — Super Admin", () => {
  test("Scenario 26: roles are listed with their status and counts", async ({
    page,
  }) => {
    await page.goto("/roles");

    await expect(
      page.getByRole("heading", { name: "Roles & Permissions" }),
    ).toBeVisible();

    // The seeded lifecycle fixtures, each in a different state.
    await expect(page.getByRole("cell", { name: "SUPER_ADMIN" })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "RBAC_DRAFT_ROLE" }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "RBAC_INACTIVE_ROLE" }),
    ).toBeVisible();
  });

  test("Scenario 27: a new role is created as a draft", async ({ page }) => {
    await page.goto("/roles/new");

    await page.getByLabel(/Role Code/).fill(SCRATCH_CODE);
    await page.getByLabel(/Role Name/).fill("Scratch Auditor");
    await page.getByRole("button", { name: "Create role" }).click();

    await page.waitForURL("**/roles");

    // Created DRAFT, not ACTIVE: the source sequence puts activation two steps
    // later, so a new role must not grant anything yet.
    const row = page.getByRole("row").filter({ hasText: SCRATCH_CODE });
    await expect(row.getByText("DRAFT")).toBeVisible();
  });

  test("Scenario 28: a duplicate role code is rejected", async ({ page }) => {
    await page.goto("/roles/new");

    await page.getByLabel(/Role Code/).fill(SCRATCH_CODE);
    await page.getByLabel(/Role Name/).fill("Duplicate");
    await page.getByRole("button", { name: "Create role" }).click();

    await expect(page.getByText(/already in use/i)).toBeVisible();
    await expect(page).toHaveURL(/\/roles\/new/);
  });

  test("Scenarios 29, 39: permissions are assigned to a role", async ({
    page,
  }) => {
    await page.goto("/roles");
    await page
      .getByRole("row")
      .filter({ hasText: SCRATCH_CODE })
      .getByRole("link")
      .click();

    await expect(
      page.getByRole("heading", { name: "Module permissions" }),
    ).toBeVisible();

    await page.locator('input[value="users.view"]').check();
    await page.getByRole("button", { name: "Save permissions" }).click();

    await expect(page.getByText("Permissions updated.")).toBeVisible();
    await expect(page.locator('input[value="users.view"]')).toBeChecked();
  });

  test("Scenario 30: Save & Activate makes the role active", async ({
    page,
  }) => {
    await page.goto("/roles");

    const row = page.getByRole("row").filter({ hasText: SCRATCH_CODE });
    await row.getByRole("button", { name: "Activate" }).click();

    await expect(page.getByText("Role activated.")).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: SCRATCH_CODE })
        .getByText("ACTIVE", { exact: true }),
    ).toBeVisible();
  });

  test("Scenario 38: a permission is removed from a role", async ({ page }) => {
    await page.goto("/roles");
    await page
      .getByRole("row")
      .filter({ hasText: SCRATCH_CODE })
      .getByRole("link")
      .click();

    await page.locator('input[value="users.view"]').uncheck();
    await page.getByRole("button", { name: "Save permissions" }).click();

    await expect(page.getByText("Permissions updated.")).toBeVisible();
    await expect(page.locator('input[value="users.view"]')).not.toBeChecked();
  });
});

test.describe("Role & Permission Management — system role protection", () => {
  test("a system role offers no delete or deactivate control", async ({
    page,
  }) => {
    await page.goto("/roles");

    const row = page.getByRole("row").filter({ hasText: "SUPER_ADMIN" });
    await expect(row.getByText("system role")).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /Deactivate/ })).toHaveCount(
      0,
    );
  });

  test("the API refuses to delete a system role even when called directly", async ({
    request,
  }) => {
    // Hiding the button is UX; this is the boundary. Without it an organization
    // can delete SUPER_ADMIN and lock every administrator out permanently.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);

    const list = await api.get(`/roles`);
    const body = (await list.json()) as {
      roles: Array<{ roleId: string; code: string }>;
    };
    const system = body.roles.find((role) => role.code === "SUPER_ADMIN");
    expect(system).toBeDefined();

    const response = await api.delete(`/roles/${system!.roleId}`);
    expect(response.status()).toBe(409);
  });

  test("the API refuses to deactivate a system role", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);

    const list = await api.get(`/roles`);
    const body = (await list.json()) as {
      roles: Array<{ roleId: string; code: string }>;
    };
    const system = body.roles.find((role) => role.code === "SUPER_ADMIN");

    const response = await api.post(`/roles/${system!.roleId}/status`, {
      status: "INACTIVE",
    });
    expect(response.status()).toBe(409);
  });
});

test.describe("Role & Permission Management — delegation", () => {
  test("the editor disables a permission the actor does not hold", async ({
    page,
  }) => {
    await page.goto("/roles");
    await page
      .getByRole("row")
      .filter({ hasText: "RBAC_DRAFT_ROLE" })
      .getByRole("link")
      .click();

    // No administrator holds field.checkin — only field staff check in. The
    // subset rule is surfaced before the submit rather than only in a 403.
    await expect(page.locator('input[value="field.checkin"]')).toBeDisabled();
    await expect(page.locator('input[value="users.view"]')).toBeEnabled();
  });

  test("Rule 27: the API refuses a permission the actor does not hold", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);

    const list = await api.get(`/roles`);
    const body = (await list.json()) as {
      roles: Array<{ roleId: string; code: string }>;
    };
    const draft = body.roles.find((role) => role.code === "RBAC_DRAFT_ROLE");

    const response = await api.put(`/roles/${draft!.roleId}/permissions`, {
      permissions: ["field.checkin"],
    });

    // Even a Super Admin is refused: the rule is about what you hold, not who
    // you are, which is what makes it real rather than a role check in disguise.
    expect(response.status()).toBe(403);
  });
});

test.describe("Role & Permission Management — Branch Admin confinement", () => {
  // Runs as the Branch Admin rather than the Super Admin the project defaults
  // to: the point of these tests is what a branch-confined caller can reach.
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenario 40: no create control is offered", async ({ page }) => {
    await page.goto("/roles");

    await expect(
      page.getByRole("heading", { name: "Roles & Permissions" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Create role" })).toHaveCount(
      0,
    );
  });

  test("Scenario 40: creating a role directly is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN_MOBILE);

    const response = await api.post(`/roles`, {
      code: "SNEAKY",
      name: "Sneaky",
      permissions: [],
    });

    expect(response.status()).toBe(403);
  });

  test("the role name is not a link without roles.update", async ({ page }) => {
    await page.goto("/roles");

    // A Branch Admin holds roles.view but not roles.update, so the list offers
    // no way in — the detail page is where editing happens.
    const row = page.getByRole("row").filter({ hasText: "RBAC_DRAFT_ROLE" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link")).toHaveCount(0);
  });

  test("the permission editor is read-only when reached directly", async ({
    page,
    request,
  }) => {
    // Navigated by URL rather than by clicking, since the list offers no link.
    // Reaching the screen is allowed; writing from it is not — the shape
    // Q-RBAC-21 gives a Branch Admin.
    const api = await apiAs(request, SUPER_ADMIN_MOBILE);
    const list = await api.get(`/roles`);
    const body = (await list.json()) as {
      roles: Array<{ roleId: string; code: string }>;
    };
    const draft = body.roles.find((role) => role.code === "RBAC_DRAFT_ROLE");
    await page.goto(`/roles/${draft!.roleId}`);

    await expect(
      page.getByRole("heading", { name: "Module permissions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save permissions" }),
    ).toHaveCount(0);
  });
});

test.describe("Role & Permission Management — deletion", () => {
  test("Scenario 56: deleting an assigned role is blocked and says why", async ({
    page,
  }) => {
    await page.goto("/roles");

    // RBAC_ASSIGNED_ROLE is held by 9000000015 in the seed.
    const row = page.getByRole("row").filter({ hasText: "RBAC_ASSIGNED_ROLE" });
    await row.getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("button", { name: "Delete", exact: true })
      .last()
      .click();

    await expect(page.getByText(/Deactivate this role instead/i)).toBeVisible();
    await expect(page.getByText(/assigned users/i)).toBeVisible();
  });
});
