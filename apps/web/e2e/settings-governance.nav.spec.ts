import { expect, test } from "@playwright/test";

import { navSections } from "../src/layout/nav-items";

/**
 * Sidebar links for Module 17 lead somewhere real.
 *
 * A link added to the nav without its page is invisible in a render test of the
 * pages themselves — the sidebar entry for Branch Settings pointed at a 404 and
 * nothing but following the link would have caught it.
 *
 * `nav-items.test.ts` now resolves every menu path against the app directory
 * without a browser, which catches a missing page far more cheaply. This spec
 * covers what that one cannot: that the link is reachable through the UI — the
 * group opens, the link renders, and following it produces a real screen rather
 * than a redirect to the dashboard.
 *
 * The names come from the nav source rather than a copy of it. A hardcoded list
 * silently stops covering an entry the moment one is renamed or added.
 */

const COMPANY_SETTINGS_LINKS = navSections
  .flatMap((section) => section.items)
  .find((item) => item.name === "Company Settings")
  ?.subItems?.map((sub) => sub.name);

test.describe("Super Admin", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  /**
   * One test walking every link, not one test per link: this spec is in the
   * RBAC group and shares its rate-limit budget, so eleven navigations across
   * eleven tests would each pay the sign-in and dashboard cost again.
   */
  test("every Company Settings link reaches a page", async ({ page }) => {
    expect(
      COMPANY_SETTINGS_LINKS,
      "Company Settings group not found",
    ).toBeDefined();

    await page.goto("/");

    for (const name of COMPANY_SETTINGS_LINKS ?? []) {
      // The group is collapsed until its parent is opened, and returns to its
      // route-derived state after each navigation.
      await page
        .getByRole("button", { name: /Company Settings/i })
        .first()
        .click();

      const link = page.getByRole("link", { name, exact: true }).first();
      await expect(link, `"${name}" is missing from the menu`).toBeVisible();
      await link.click();

      await expect(
        page.getByRole("heading", { name: /404/i }),
        `"${name}" reaches a 404`,
      ).toHaveCount(0);
    }
  });

  /**
   * The bug this whole redesign turned on: an exact-match active state left
   * every detail route with nothing highlighted and its group snapped shut, so
   * opening a record lost the reader's place in the menu.
   */
  test("a detail route keeps its group open and its entry marked", async ({
    page,
  }) => {
    await page.goto("/customers");

    const firstRow = page.getByRole("link").filter({ hasText: /CUS/ }).first();
    if ((await firstRow.count()) === 0) test.skip();
    await firstRow.click();

    await expect(page).toHaveURL(/\/customers\/.+/);

    const customersLink = page
      .getByRole("link", { name: "Customers", exact: true })
      .first();
    await expect(customersLink).toBeVisible();
    await expect(customersLink).toHaveAttribute("aria-current", "page");
  });
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
    await expect(
      page.getByRole("cell", { name: "Branch", exact: true }),
    ).toHaveCount(0);
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
