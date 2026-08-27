import { expect, test } from "@playwright/test";

/**
 * Sidebar links for Module 17 lead somewhere real.
 *
 * A link added to the nav without its page is invisible in a render test of the
 * pages themselves — the sidebar entry for Branch Settings pointed at a 404 and
 * nothing but following the link would have caught it.
 */

const LINKS = [
  "Organization Settings",
  "Branch Settings",
  "Configuration Changes",
  "Operational Controls",
  "Maintenance Jobs",
  "Configuration Transfer",
  "Data Retention",
  "Audit Trail",
];

test.describe("Super Admin", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  for (const name of LINKS) {
    test(`sidebar link "${name}" reaches a page`, async ({ page }) => {
      await page.goto("/");

      // The group is collapsed until its parent is opened.
      await page
        .getByRole("button", { name: /Company Settings/i })
        .first()
        .click();

      const link = page.getByRole("link", { name, exact: true }).first();
      await expect(link).toBeVisible();
      await link.click();

      await expect(
        page.getByRole("heading", { name: /404/i }),
      ).toHaveCount(0);
    });
  }
});

test.describe("Scope separation", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  /**
   * `GET /settings` without a `branchId` returns EVERY branch's overrides
   * alongside the organization rows — by design, since a branch-confined caller
   * needs the org row as their effective default. An unscoped Super Admin
   * therefore gets them all, and the organization screen has to filter.
   *
   * Without that filter the same setting appeared once per branch under one
   * name, and editing such a row wrote to that branch from a screen headed
   * "Organization Settings". This asserts no branch-scoped row is shown there.
   */
  test("organization settings shows no branch-scoped rows", async ({
    page,
  }) => {
    await page.goto("/admin/settings/organization");

    await expect(
      page.getByRole("heading", { name: /Organization Settings/i }).first(),
    ).toBeVisible();

    // The Scope column reads "Organization" for every row on this screen.
    await expect(page.getByRole("cell", { name: "Branch", exact: true })).toHaveCount(
      0,
    );
  });
});

test.describe("Branch Admin", () => {
  test.use({ storageState: "e2e/.auth/branch-admin.json" });

  /**
   * The scope boundary: a Branch Admin holds `settings.view` and must REACH
   * these screens — being refused at the act is what the scenarios assert, and a
   * 404 or a redirect here would prove nothing about scope.
   */
  test("reaches branch settings scoped to their own branch", async ({
    page,
  }) => {
    await page.goto("/admin/settings/branch");

    await expect(
      page.getByRole("heading", { name: /Branch Settings/i }).first(),
    ).toBeVisible();

    // Pinned to their own branch — no picker is offered.
    await expect(page.getByLabel("Branch")).toHaveCount(0);
  });

  test("reaches the audit trail", async ({ page }) => {
    await page.goto("/admin/audit");

    await expect(
      page.getByRole("heading", { name: /Audit Trail/i }).first(),
    ).toBeVisible();
  });
});
