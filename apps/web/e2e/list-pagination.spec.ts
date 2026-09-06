import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./support/session";

/**
 * List pagination on the two screens whose API supports it.
 *
 * `ListCollectionsDto` and `ListDisbursementsDto` have accepted `page` and
 * `pageSize` all along and the responses have always carried a `total`, but the
 * web client never forwarded the parameters — so every list silently showed the
 * first page (20 and 25 rows) of a much larger set, with nothing on screen to
 * say more existed. The seeded database has 464 collections across 24 pages.
 *
 * Customers and loan applications are deliberately absent: their DTOs accept no
 * page parameter at all, and the DTOs are whitelist-validated, so sending one
 * would be rejected rather than ignored.
 */
test.describe("List pagination", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("collections pages through the record set", async ({ page }) => {
    await page.goto("/loans/collections");

    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager).toBeVisible();
    // The count is of everything matching, not of the rows on screen.
    await expect(pager).toContainText("Showing 1–20 of");

    const firstOnPageOne = await page
      .locator("tbody tr td")
      .first()
      .innerText();

    await page.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/page=2/);

    await expect(pager).toContainText("Showing 21–40 of");
    // Different rows, not the same page re-rendered under a new number.
    await expect(page.locator("tbody tr td").first()).not.toHaveText(
      firstOnPageOne,
    );
  });

  test("a page link carries the active filters", async ({ page }) => {
    // Dropping the filter on a page turn would silently widen the result set —
    // the reader would believe they were still looking at posted collections.
    await page.goto("/loans/collections?status=POSTED");

    const next = page.getByRole("link", { name: "Next" });
    if ((await next.count()) === 0) {
      test.skip(true, "Not enough POSTED collections to paginate");
    }
    await expect(next).toHaveAttribute("href", /status=POSTED/);
    await expect(next).toHaveAttribute("href", /page=2/);
  });

  test("the first page offers no Previous link", async ({ page }) => {
    await page.goto("/loans/collections");

    // Rendered as inert text rather than a link to nowhere, so the control does
    // not shift position between pages.
    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toContainText("Previous");
    await expect(page.getByRole("link", { name: "Previous" })).toHaveCount(0);
  });

  test("a junk page parameter falls back to the first page", async ({
    page,
  }) => {
    // The URL is a user-editable surface here; refusing to render is a worse
    // answer than showing page one.
    await page.goto("/loans/collections?page=not-a-number");

    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toContainText("Page 1 of");
  });

  test("disbursements paginate too", async ({ page }) => {
    await page.goto("/loans/disbursements");

    const pager = page.getByRole("navigation", { name: "Pagination" });
    if ((await pager.count()) === 0) {
      test.skip(true, "Fewer than one page of disbursements seeded");
    }
    await expect(pager).toContainText("Showing 1–");
  });
});
