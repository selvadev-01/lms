import { describe, expect, it } from "vitest";

import {
  DASHBOARD_PERIOD_TYPE_OPTIONS,
  MAX_DASHBOARD_RANGE_DAYS,
  dashboardFilterSchema,
} from "./dashboard";

/**
 * Module 18 — dashboard filter validation.
 *
 * This schema guards a *view*, not a record, so what is worth pinning is
 * narrower than elsewhere in this package:
 *
 *  1. **The three preset periods carry no dates.** They are resolved on the
 *     server from the Asia/Kolkata business date. A schema that demanded dates
 *     for them would force every screen to post a value the server ignores, and
 *     a screen that then computed those dates in the browser would be deciding
 *     the business date from the device clock.
 *  2. **A custom period carries both ends, ordered, and bounded.** Scenario 5
 *     and Rule 37. These live in a `.superRefine`, and the trap they were
 *     written around is that extending a refined schema drops it — asserting
 *     them here is what would catch a future `.extend()`.
 *  3. **Nothing that decides authorization is representable.** No
 *     `organizationId`, no `businessDate`, and `branchId` only as a request.
 *     These assertions look like they test nothing; they pin the absence,
 *     which is the part a later change could quietly undo.
 */

function messagesFor(result: { success: boolean; error?: unknown }): string[] {
  if (result.success) return [];
  const error = result.error as { issues: { message: string }[] };
  return error.issues.map((issue) => issue.message);
}

describe("dashboardFilterSchema", () => {
  it("accepts an empty filter, which is the default view", () => {
    // The dashboard loads before anyone touches a control. If the filter were
    // mandatory the home screen could not render on first paint.
    expect(dashboardFilterSchema.safeParse({}).success).toBe(true);
  });

  it.each(["TODAY", "THIS_WEEK", "THIS_MONTH"] as const)(
    "accepts %s with no dates, because the server derives them",
    (periodType) => {
      expect(dashboardFilterSchema.safeParse({ periodType }).success).toBe(
        true,
      );
    },
  );

  it("ignores dates supplied alongside a preset period", () => {
    // Not an error: a screen switching from CUSTOM back to TODAY may still have
    // the old dates in its form. The server derives the range from the business
    // date regardless, so refusing here would only be noise.
    const result = dashboardFilterSchema.safeParse({
      periodType: "TODAY",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a valid custom range", () => {
    const result = dashboardFilterSchema.safeParse({
      periodType: "CUSTOM",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(result.success).toBe(true);
  });

  it("names both missing ends of a custom range at once", () => {
    // Scenario Outline. Both are reported together rather than one at a time:
    // a user fixing one wants to hear about the other in the same pass.
    const messages = messagesFor(
      dashboardFilterSchema.safeParse({ periodType: "CUSTOM" }),
    );

    expect(messages).toContain("Period Start Date is required");
    expect(messages).toContain("Period End Date is required");
  });

  it("rejects a custom range missing only the start date", () => {
    const messages = messagesFor(
      dashboardFilterSchema.safeParse({
        periodType: "CUSTOM",
        toDate: "2026-01-31",
      }),
    );

    expect(messages).toContain("Period Start Date is required");
  });

  it("rejects a custom range missing only the end date", () => {
    const messages = messagesFor(
      dashboardFilterSchema.safeParse({
        periodType: "CUSTOM",
        fromDate: "2026-01-01",
      }),
    );

    expect(messages).toContain("Period End Date is required");
  });

  it("rejects an inverted custom range (Scenario 5)", () => {
    const messages = messagesFor(
      dashboardFilterSchema.safeParse({
        periodType: "CUSTOM",
        fromDate: "2026-01-31",
        toDate: "2026-01-01",
      }),
    );

    expect(messages).toContain(
      "Period End Date must be on or after Period Start Date",
    );
  });

  it("accepts a range of exactly the maximum span", () => {
    // 366 days inclusive: 2024 is a leap year, so Jan 1 to Dec 31 is 366 days.
    const result = dashboardFilterSchema.safeParse({
      periodType: "CUSTOM",
      fromDate: "2024-01-01",
      toDate: "2024-12-31",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a range one day beyond the maximum span", () => {
    const messages = messagesFor(
      dashboardFilterSchema.safeParse({
        periodType: "CUSTOM",
        fromDate: "2024-01-01",
        toDate: "2025-01-01",
      }),
    );

    expect(messages).toContain(
      `Date range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days`,
    );
  });

  it("rejects an unknown period type", () => {
    expect(
      dashboardFilterSchema.safeParse({ periodType: "THIS_QUARTER" }).success,
    ).toBe(false);
  });

  it("rejects an untouched select, which posts an empty string", () => {
    // The reason the message lives on the enum rather than on a `.min(1)`.
    expect(dashboardFilterSchema.safeParse({ periodType: "" }).success).toBe(
      false,
    );
  });

  it("rejects a branchId that is not a uuid", () => {
    const messages = messagesFor(
      dashboardFilterSchema.safeParse({ branchId: "branch-a" }),
    );

    expect(messages).toContain("Select a valid branch");
  });

  it("strips organizationId and businessDate rather than accepting them", () => {
    // Rules 2 and 16. The organization comes from the JWT and the business date
    // from the server's Asia/Kolkata clock. Zod's default object behaviour drops
    // unknown keys, so a caller that sends either gets a parsed value that does
    // not contain it — the field is unrepresentable, not merely ignored.
    const result = dashboardFilterSchema.safeParse({
      periodType: "TODAY",
      organizationId: "00000000-0000-4000-8000-000000000000",
      businessDate: "2020-01-01",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty("organizationId");
    expect(result.success && result.data).not.toHaveProperty("businessDate");
  });
});

describe("DASHBOARD_PERIOD_TYPE_OPTIONS", () => {
  it("labels every period the schema accepts", () => {
    // A period the schema takes but the selector cannot offer is unreachable;
    // one the selector offers but the schema refuses fails on submit.
    expect(DASHBOARD_PERIOD_TYPE_OPTIONS.map((option) => option.value)).toEqual(
      ["TODAY", "THIS_WEEK", "THIS_MONTH", "CUSTOM"],
    );
  });
});
