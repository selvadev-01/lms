import { test, expect } from "@playwright/test";

test("dashboard redirects to sign-in when unauthenticated", async ({
  page,
}) => {
  // The dashboard used to be publicly reachable. Since route protection landed
  // (src/proxy.ts), an anonymous visitor is sent to sign-in with the originally
  // requested path preserved.
  await page.goto("/");

  await expect(page).toHaveURL(/\/signin/);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("sign-in page renders", async ({ page }) => {
  await page.goto("/signin");

  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("password toggle is keyboard reachable", async ({ page }) => {
  await page.goto("/signin");

  // Regression guard: this control was a <span onClick> with no keyboard
  // affordance until Phase 1. It must stay a real button.
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Hide password" }),
  ).toBeVisible();
});
