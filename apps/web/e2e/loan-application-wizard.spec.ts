import { expect, test, type Page } from "@playwright/test";

import { STORAGE_STATE } from "./support/session";

/**
 * The loan application wizard, driven through the form.
 *
 * Written BEFORE the wizard is rewritten to be URL-driven, deliberately: every
 * other spec creates applications through the API (`loan-applications.spec.ts`,
 * `approval-workflow.spec.ts`, `disbursal.spec.ts` all POST directly), so the
 * four-step form had no coverage at all and a rewrite would have been
 * unverifiable. This pins the behaviour that must survive.
 *
 * It anchors on accessible names — "Next", "Back", "Create Draft" and the field
 * labels — because those are the only stable handles the wizard has today. If
 * the rewrite renames a control, update this spec deliberately in the same
 * commit rather than loosening the selector.
 */

const AMOUNT_RUPEES = "50000";

/** Step 1: pick the first customer the branch-scoped search returns. */
async function chooseFirstCustomer(page: Page) {
  const list = page.getByRole("radio");
  await expect(list.first()).toBeVisible();
  await list.first().check();
}

/**
 * Advance one step.
 *
 * Waits for Next to be enabled first. The button is gated on the step's schema
 * slice, which is derived from React state, so a click fired the instant after
 * `check()` can land while it is still disabled — Playwright reports that as a
 * silent no-op and the URL simply never changes. Under parallel load that race
 * is easy to hit and impossible to read from the failure message.
 */
async function next(page: Page) {
  const button = page.getByRole("button", { name: "Next", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

test.describe("Loan application wizard", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test.beforeEach(async ({ page }) => {
    await page.goto("/loans/applications/new");
  });

  test("opens on the customer step with Back disabled", async ({ page }) => {
    // Step one of four: there is nowhere to go back to.
    await expect(
      page.getByRole("button", { name: "Back", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("list", { name: "Application steps" }),
    ).toBeVisible();
  });

  test("Next is blocked until the step is answered", async ({ page }) => {
    // No customer chosen yet, so advancing would carry an incomplete
    // application forward.
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();

    await chooseFirstCustomer(page);
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeEnabled();
  });

  test("walks all four steps and creates a draft", async ({ page }) => {
    // 1 — Customer
    await chooseFirstCustomer(page);
    await next(page);

    // 2 — Loan Details
    await page.getByLabel("Loan Type").selectOption({ index: 1 });
    await page.getByLabel("Loan Amount (₹)").fill(AMOUNT_RUPEES);
    // Anchored: the visible label is "Purpose *" (the asterisk is part of the
    // accessible name), and a bare "Purpose" would also match
    // "Purpose detail (optional)".
    await page.getByLabel(/^Purpose \*$/).selectOption({ index: 1 });
    await next(page);

    // 3 — Scheme & Terms. Choosing a scheme adopts its rate, so the rate and
    // interest type arrive prefilled from the scheme's price list.
    await page.getByLabel("Loan Scheme").selectOption({ index: 1 });
    // Frequency and Duration are selects, not free text, and their options come
    // from the scheme chosen above — the scheme is the price list, so the terms
    // it permits are the only ones offered.
    await page.getByLabel("Frequency").selectOption({ index: 1 });
    await page.getByLabel("Duration (periods)").selectOption({ index: 1 });
    await next(page);

    // 4 — EMI Preview. The schedule is computed server-side and gates submission.
    await page.getByRole("button", { name: "Calculate EMI" }).click();
    await expect(
      page.getByRole("button", { name: "Create Draft" }),
    ).toBeEnabled({ timeout: 15_000 });

    await page.getByRole("button", { name: "Create Draft" }).click();

    // Creating the draft opens the application detail page, where documents are
    // attached and the final review happens.
    await expect(page).toHaveURL(/\/loans\/applications\/[0-9a-f-]{36}/, {
      timeout: 20_000,
    });
  });

  test("Back returns to the previous step with the answer intact", async ({
    page,
  }) => {
    await chooseFirstCustomer(page);
    await next(page);

    await page.getByLabel("Loan Amount (₹)").fill(AMOUNT_RUPEES);
    await page.getByRole("button", { name: "Back", exact: true }).click();

    // The chosen customer must still be chosen — stepping back is not a reset.
    await expect(page.getByRole("radio").first()).toBeChecked();

    // And going forward again must not have lost the amount.
    await next(page);
    await expect(page.getByLabel("Loan Amount (₹)")).toHaveValue(AMOUNT_RUPEES);
  });

  test("puts the step in the URL so it can be linked and shared", async ({
    page,
  }) => {
    // Before the rewrite the step was `useState`, so every screen of the wizard
    // had the same address and none could be returned to.
    await expect(page).toHaveURL(/\/loans\/applications\/new$/);

    await chooseFirstCustomer(page);
    await next(page);
    await expect(page).toHaveURL(/[?&]step=details/);
  });

  test("survives a refresh with the answers intact", async ({ page }) => {
    await chooseFirstCustomer(page);
    await next(page);
    await page.getByLabel("Loan Amount (₹)").fill(AMOUNT_RUPEES);

    // The whole point of persisting the draft: a reload used to drop the user
    // back to step one having lost everything typed.
    await page.reload();

    await expect(page).toHaveURL(/[?&]step=details/);
    await expect(page.getByLabel("Loan Amount (₹)")).toHaveValue(AMOUNT_RUPEES);
  });

  test("browser Back steps backwards rather than leaving the wizard", async ({
    page,
  }) => {
    await chooseFirstCustomer(page);
    await next(page);
    await expect(page).toHaveURL(/[?&]step=details/);

    await page.goBack();

    // Back must land on the previous step, not on whatever preceded the wizard.
    await expect(page).toHaveURL(/\/loans\/applications\/new$/);
    await expect(page.getByRole("radio").first()).toBeChecked();
  });

  test("a deep link past the answered steps falls back to the first gap", async ({
    page,
  }) => {
    // A pasted link into a fresh tab has no draft behind it, so step four would
    // render a Create button that could only fail.
    //
    // `beforeEach` has already loaded the page in this test's own context, and
    // Playwright gives each test a fresh context — so sessionStorage is empty
    // here without any explicit clearing.
    await page.goto("/loans/applications/new?step=preview");

    await expect(page).toHaveURL(
      /\/loans\/applications\/new(\?step=customer)?$/,
    );
    await expect(
      page.getByRole("button", { name: "Back", exact: true }),
    ).toBeDisabled();
  });

  test("customer search reports an empty result without claiming an outage", async ({
    page,
  }) => {
    await page.getByLabel("Search customers").fill("zzz-no-such-customer-zzz");

    await expect(
      page.getByText("No customer matches that search."),
    ).toBeVisible({ timeout: 10_000 });
    // The escape hatch to Module 04, which owns customer creation.
    await expect(
      page.getByRole("link", { name: "Create customer record" }),
    ).toBeVisible();
  });
});
