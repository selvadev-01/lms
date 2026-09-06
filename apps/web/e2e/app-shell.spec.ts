import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./support/session";

/**
 * The admin chrome's accessibility landmarks.
 *
 * These are cheap to add, invisible when working, and silently lost by any
 * refactor of `AdminShell` — nothing else in the suite would notice their
 * absence, which is exactly why they need a guard.
 *
 * The `chromium` project is unauthenticated by default, so the session is
 * opted into per describe block — the same convention `dashboard.spec.ts` uses.
 * Any authenticated admin route exercises the shell; `/branches` is a cheap one.
 */
test.describe("Admin shell landmarks", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("exposes a single main landmark wrapping the page content", async ({
    page,
  }) => {
    await page.goto("/branches");

    const main = page.getByRole("main");
    await expect(main).toHaveCount(1);
    // The page heading must live inside it, not beside it — otherwise "skip to
    // content" lands the user past the thing they came to read. No level is
    // asserted: /branches is not yet converted to `PageShell`, so it still
    // renders the legacy h2 from `PageBreadCrumb`.
    await expect(
      main.getByRole("heading", { name: "Branch Management" }),
    ).toBeVisible();
  });

  test("skip link is the first tab stop and moves focus to the content", async ({
    page,
  }) => {
    await page.goto("/branches");

    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeAttached();

    // Clipped to 1px until focused. Playwright reports `sr-only` as "visible"
    // because it still occupies layout, so assert the clipping itself — that is
    // what keeps it off the screen for sighted users while leaving it in the
    // tab order and the accessibility tree.
    const clippedWidth = await skip.evaluate(
      (el) => getComputedStyle(el).width,
    );
    expect(clippedWidth).toBe("1px");

    // One Tab from the document start must reach it, ahead of the whole
    // sidebar. That ordering is the entire point of the control.
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();

    // Focused, it must leave the clip and become a real, readable control.
    await expect
      .poll(async () => skip.evaluate((el) => getComputedStyle(el).width))
      .not.toBe("1px");

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
  });
});
