import { expect, test } from "@playwright/test";

/**
 * Module 17 render smoke check.
 *
 * This is NOT the scenario suite — it asserts only that each new screen reaches
 * a rendered heading rather than a Next.js error overlay or an empty shell. A
 * server component that throws still returns 200 with an error page, so the
 * status code alone would not catch a broken page; the heading is what proves
 * the component tree actually rendered.
 */

const PAGES = [
  { path: "/admin/settings/organization", heading: /Organization Settings/i },
  { path: "/admin/settings/branch", heading: /Branch Settings/i },
  { path: "/admin/settings/changes", heading: /Configuration Changes/i },
  { path: "/admin/settings/operational", heading: /Operational Controls/i },
  { path: "/admin/settings/transfer", heading: /Configuration Transfer/i },
  { path: "/admin/settings/retention", heading: /Data Retention/i },
  { path: "/admin/maintenance/jobs", heading: /Maintenance Jobs/i },
  { path: "/admin/audit", heading: /Audit Trail/i },
];

test.use({ storageState: "e2e/.auth/super-admin.json" });

for (const page of PAGES) {
  test(`renders ${page.path}`, async ({ page: p }) => {
    const errors: string[] = [];
    p.on("pageerror", (error) => errors.push(error.message));

    await p.goto(page.path);

    await expect(
      p.getByRole("heading", { name: page.heading }).first(),
    ).toBeVisible();

    // A client component that throws leaves the heading in place, so the
    // absence of the heading is not the only failure worth catching.
    expect(errors).toEqual([]);
  });
}
