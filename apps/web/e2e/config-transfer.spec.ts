import { expect, test } from "@playwright/test";

/**
 * Configuration import through the UI (Scenarios 59-62).
 *
 * The per-entry `problems` list travels a path nothing else uses: the API puts
 * it beside `message` in a 400 body, and `api-call.ts` has to forward it or the
 * generic failure state drops it silently. A unit test of the service cannot
 * catch that, because the loss happens in the web layer.
 */

test.use({ storageState: "e2e/.auth/super-admin.json" });

test.describe("Configuration Transfer", () => {
  test("Scenario 60: a rejected import names every entry at fault", async ({
    page,
  }) => {
    await page.goto("/admin/settings/transfer");

    await page.getByLabel("Configuration document").fill(
      JSON.stringify({
        schemaVersion: 1,
        settings: [
          { settingCode: "MADE_UP_KEY", value: "x" },
          { settingCode: "ANOTHER_FAKE", value: "y" },
        ],
      }),
    );

    await page.getByRole("button", { name: /Import/i }).click();

    await expect(
      page.getByRole("heading", { name: "Not imported" }),
    ).toBeVisible();

    // The point of the test: both codes are named, not just a generic failure.
    await expect(page.getByText("MADE_UP_KEY")).toBeVisible();
    await expect(page.getByText("ANOTHER_FAKE")).toBeVisible();
  });

  test("a dry run reports what would change and writes nothing", async ({
    page,
  }) => {
    await page.goto("/admin/settings/transfer");

    await page.getByLabel("Configuration document").fill(
      JSON.stringify({
        schemaVersion: 1,
        settings: [{ settingCode: "ORG_DISPLAY_NAME", value: "Dry Run Only" }],
      }),
    );

    // Checked by default; asserted rather than assumed, because an unchecked
    // box here would write the value this test claims it does not.
    await expect(
      page.getByRole("checkbox", { name: /Check only/i }),
    ).toBeChecked();

    await page.getByRole("button", { name: /Import/i }).click();

    await expect(page.getByText(/Nothing was written/i)).toBeVisible();
  });

  test("malformed JSON is refused before the request is sent", async ({
    page,
  }) => {
    await page.goto("/admin/settings/transfer");

    await page.getByLabel("Configuration document").fill("{not json");
    await page.getByRole("button", { name: /Import/i }).click();

    await expect(page.getByText(/not valid JSON/i)).toBeVisible();
  });
});
