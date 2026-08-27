import { expect, test } from "@playwright/test";

import {
  API_BASE,
  ORG_CODE,
  SEED_PASSWORD,
  STORAGE_STATE,
} from "./support/session";

/**
 * Module 18 — Dashboard & Home.
 *
 * # What this spec is for
 *
 * The dashboard writes nothing, so there are no fixtures to create and no state
 * to clean up. What is worth proving end to end is the part unit tests cannot
 * reach: that the authorization decisions made in the service actually change
 * what a real browser renders, and that the API refuses the same things it
 * hides.
 *
 * Four properties, each corresponding to a way the screen could look right and
 * be wrong:
 *
 *  1. **Widget visibility follows permission.** A Field Employee is offered
 *     four widgets; a Super Admin seven (Scenario 2).
 *  2. **Hiding is not the boundary.** Requesting a hidden widget's endpoint
 *     directly still returns 403 (Scenario 9).
 *  3. **A branch user cannot reach another branch**, through the UI or through
 *     a request parameter (Scenario 7).
 *  4. **No figure is fabricated.** A rejected filter reports itself, and a
 *     withheld figure renders as an em dash rather than a zero.
 *
 * # Why the figures themselves are not asserted
 *
 * Every number here is a live aggregate over rows the other RBAC specs are
 * concurrently creating. Asserting "outstanding is ₹X" would pass on a fresh
 * seed and fail the moment this spec ran after `disbursal.spec.ts`. The
 * assertions are on *shape and authorization* instead: which widgets appear,
 * what a refusal does, and that a value is present and formatted — never on a
 * particular total.
 */

/** Widgets a Super Admin holds every permission for. */
const ALL_WIDGETS = [
  "Loan Summary",
  "Collection Summary",
  "Overdue & Recovery",
  "Cash Position",
  "Operational Alerts",
  "Quick Actions",
  "Recent Activity",
];

/** The two a Field Employee lacks the owning permission for. */
const FIELD_EMPLOYEE_HIDDEN = ["Cash Position", "Recent Activity"];

test.describe("Dashboard — Super Admin", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenario 1: opens the dashboard with every authorized widget", async ({
    page,
  }) => {
    await page.goto("/");

    for (const title of ALL_WIDGETS) {
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
    }

    // Scenario 36: nothing rendered a controlled failure state.
    await expect(page.getByText("could not be loaded")).toHaveCount(0);
  });

  test("Scenario 1: reports the business date and an unlocked branch scope", async ({
    page,
  }) => {
    await page.goto("/");

    // Server-derived, Asia/Kolkata. Asserted as a shape rather than a value:
    // the date this runs on is not this spec's to decide.
    await expect(
      page.getByText(/Business date \d{4}-\d{2}-\d{2}/),
    ).toBeVisible();

    // An org-level caller may look across branches, so the selector is usable.
    await expect(page.getByLabel("Branch")).toBeEnabled();
  });

  test("Scenario 4: an as-of-now widget says the period did not apply", async ({
    page,
  }) => {
    await page.goto("/");

    // Rule 11: a widget that ignored the filter must say so rather than let a
    // reader assume its figures were filtered.
    await expect(
      page.getByText("Current position — not affected by the selected period."),
    ).toBeVisible();
    await expect(
      page.getByText("Posted collections within the selected period."),
    ).toBeVisible();
  });

  test("Scenario 5: an inverted custom range is rejected and the view survives", async ({
    page,
  }) => {
    await page.goto(
      "/?periodType=CUSTOM&fromDate=2026-01-31&toDate=2026-01-01",
    );

    await expect(
      page.getByText("Period End Date must be on or after Period Start Date"),
    ).toBeVisible();

    // The previous valid state remains available: the filter bar is still
    // there to correct, and the widgets did not vanish.
    await expect(page.getByLabel("Period")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Loan Summary", exact: true }),
    ).toBeVisible();
  });

  test("Scenario 5: a range beyond the supported span is rejected", async ({
    page,
  }) => {
    await page.goto(
      "/?periodType=CUSTOM&fromDate=2024-01-01&toDate=2025-06-01",
    );

    // Rule 42 sends anything larger to the reporting path.
    await expect(
      page.getByText("Date range cannot exceed 366 days"),
    ).toBeVisible();
  });

  test("Scenario 29: quick actions link into the owning workflows", async ({
    page,
  }) => {
    await page.goto("/");

    // A quick action is a link and nothing more (Rule 25) — the destination
    // performs every check.
    await expect(
      page.getByRole("link", { name: "Add Customer", exact: true }),
    ).toHaveAttribute("href", "/customers/new");
    await expect(
      page.getByRole("link", { name: "New Loan Application", exact: true }),
    ).toHaveAttribute("href", "/loans/applications/new");
  });

  test("the suggested /dashboard route resolves to the home screen", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Loan Summary", exact: true }),
    ).toBeVisible();
  });
});

test.describe("Dashboard — branch scope", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenario 7: a branch user's selector is locked to their branch", async ({
    page,
  }) => {
    await page.goto("/");

    const selector = page.getByLabel("Branch");
    await expect(selector).toBeDisabled();

    // Named, not merely absent: the reader must be able to tell which branch
    // they are looking at.
    await expect(page.getByText(/Business date .* · .+/)).toBeVisible();
  });

  test("Scenario 7: another branch is refused through a request parameter", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const cookies = await page.context().cookies();
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const layout = await request.get(`${API_BASE}/api/v1/dashboard/layout`, {
      headers: { cookie: header },
    });
    expect(layout.ok()).toBe(true);
    const body = (await layout.json()) as {
      scope: { branchId: string; branchLocked: boolean };
      availableBranches: { branchId: string }[];
    };

    // The caller is confined, and the scope says so.
    expect(body.scope.branchLocked).toBe(true);

    // A confined caller is offered exactly their own branch, so the layout
    // itself cannot name the one to probe with. A syntactically valid UUID
    // that is not theirs is enough: `resolveBranchScope` refuses on the
    // mismatch, before any row is read.
    expect(body.availableBranches).toHaveLength(1);
    expect(body.availableBranches[0].branchId).toBe(body.scope.branchId);

    const otherBranchId = "00000000-0000-4000-8000-000000000001";
    expect(otherBranchId).not.toBe(body.scope.branchId);

    const denied = await request.get(
      `${API_BASE}/api/v1/dashboard/widgets/LOAN_SUMMARY?branchId=${otherBranchId}`,
      { headers: { cookie: header } },
    );

    // Refused outright, not quietly narrowed to their own branch — and 403
    // rather than 404, because the refusal is about authority, not existence.
    expect(denied.status()).toBe(403);
  });
});

test.describe("Dashboard — a caller without every permission", () => {
  // A Field Employee holds `dashboard.view` but not `cash.reconciliation.view`
  // or `audit.view`. Signed in here rather than through a shared storage state
  // because no fixture covers this role, and the spec needs its exact grants.
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel(/Organization Code/).fill(ORG_CODE);
    await page.getByLabel(/Mobile Number/).fill("9000000004");
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes("signin"));
  });

  test("Scenario 2: sees only the widgets its permissions allow", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Collection Summary", exact: true }),
    ).toBeVisible();

    for (const title of FIELD_EMPLOYEE_HIDDEN) {
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toHaveCount(0);
    }
  });

  test("Scenario 9: a hidden widget is refused when requested directly", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const cookies = await page.context().cookies();
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Hiding the widget is a courtesy; this is the boundary. A caller who
    // guesses the code the layout omitted gains nothing.
    const denied = await request.get(
      `${API_BASE}/api/v1/dashboard/widgets/CASH_SUMMARY`,
      { headers: { cookie: header } },
    );

    expect(denied.status()).toBe(403);
  });

  test("Scenario 27: a withheld figure renders as a dash, never as zero", async ({
    page,
  }) => {
    await page.goto("/");

    // `legalCases` is null for a caller without a legal permission. A zero
    // would tell them there are no legal cases, which is a claim about data
    // they may not see.
    const legal = page
      .locator("div")
      .filter({ hasText: /^Legal \/ settlement/ })
      .first();

    await expect(legal).toContainText("—");
  });
});
