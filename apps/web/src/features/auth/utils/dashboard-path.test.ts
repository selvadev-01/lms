import { describe, expect, it } from "vitest";

import { dashboardPathFor } from "./dashboard-path";

describe("dashboardPathFor", () => {
  // Scenario 1: Super Admin reaches the system-wide dashboard.
  it("sends a Super Admin to the system-wide dashboard", () => {
    expect(dashboardPathFor(["SUPER_ADMIN"])).toBe("/");
  });

  // Scenario 5: Branch Admin reaches the branch dashboard.
  it("sends a Branch Admin to the branch dashboard", () => {
    expect(dashboardPathFor(["BRANCH_ADMIN"])).toBe("/branch");
  });

  it("sends a Field Employee to the field dashboard", () => {
    expect(dashboardPathFor(["FIELD_EMPLOYEE"])).toBe("/field");
  });

  it("prefers the most privileged role when several are held", () => {
    expect(dashboardPathFor(["FIELD_EMPLOYEE", "SUPER_ADMIN"])).toBe("/");
    expect(dashboardPathFor(["FIELD_EMPLOYEE", "BRANCH_ADMIN"])).toBe(
      "/branch",
    );
  });

  it("falls back to the root dashboard for an unrecognised role", () => {
    expect(dashboardPathFor([])).toBe("/");
    expect(dashboardPathFor(["CUSTOMER"])).toBe("/");
  });
});
