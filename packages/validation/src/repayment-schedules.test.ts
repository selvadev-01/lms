import { describe, expect, it } from "vitest";

import {
  exportScheduleSchema,
  listRepaymentSchedulesSchema,
  regenerateScheduleSchema,
} from "./repayment-schedules";

const VERSION = "2026-08-21T10:00:00.000Z";

/** The message for `path`, or undefined if that field parsed cleanly. */
const errorFor = (
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
  path: string,
): string | undefined =>
  result.success
    ? undefined
    : result.error?.issues.find((issue) => issue.path.join(".") === path)
        ?.message;

describe("regenerateScheduleSchema", () => {
  const valid = {
    reason: "Tenure corrected after sanction amendment",
    expectedVersion: VERSION,
  };

  it("accepts a reason and a version", () => {
    const result = regenerateScheduleSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("trims the reason", () => {
    const result = regenerateScheduleSchema.safeParse({
      ...valid,
      reason: "  Rate revised  ",
    });
    expect(result.success && result.data.reason).toBe("Rate revised");
  });

  // Scenario 43 needs the audit trail to retain *why* a version was retired, so
  // a blank reason must fail rather than record an empty string.
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("rejects a %s reason", (_label, reason) => {
    const result = regenerateScheduleSchema.safeParse({ ...valid, reason });
    expect(errorFor(result, "reason")).toBe("Reason is required");
  });

  it("caps the reason length", () => {
    const result = regenerateScheduleSchema.safeParse({
      ...valid,
      reason: "x".repeat(501),
    });
    expect(errorFor(result, "reason")).toBe(
      "Reason must be 500 characters or fewer",
    );
  });

  // Without a version a stale client could overwrite a newer schedule
  // (Scenario 41), so the token is not optional.
  it("requires expectedVersion", () => {
    const result = regenerateScheduleSchema.safeParse({ reason: "Corrected" });
    expect(result.success).toBe(false);
  });
});

describe("listRepaymentSchedulesSchema", () => {
  it("defaults paging", () => {
    const result = listRepaymentSchedulesSchema.safeParse({});
    expect(result.success && result.data).toMatchObject({
      page: 1,
      pageSize: 25,
    });
  });

  it("accepts a status filter", () => {
    const result = listRepaymentSchedulesSchema.safeParse({
      status: "SUPERSEDED",
    });
    expect(result.success && result.data.status).toBe("SUPERSEDED");
  });

  it("rejects an unknown status", () => {
    const result = listRepaymentSchedulesSchema.safeParse({ status: "LIVE" });
    expect(result.success).toBe(false);
  });

  it("caps pageSize", () => {
    const result = listRepaymentSchedulesSchema.safeParse({ pageSize: 500 });
    expect(result.success).toBe(false);
  });

  // No branchId anywhere: scope is server-side and a client value must never
  // widen it (Scenario 35). Zod strips unknown keys, so the field cannot ride in.
  it("drops a client-supplied branchId", () => {
    const result = listRepaymentSchedulesSchema.safeParse({
      branchId: "22222222-3333-4444-5555-666666666666",
    });
    expect(result.success).toBe(true);
    expect(result.success && "branchId" in result.data).toBe(false);
  });
});

describe("exportScheduleSchema", () => {
  it("defaults to csv", () => {
    const result = exportScheduleSchema.safeParse({});
    expect(result.success && result.data.format).toBe("csv");
  });

  it.each(["csv", "pdf"] as const)("accepts %s", (format) => {
    const result = exportScheduleSchema.safeParse({ format });
    expect(result.success && result.data.format).toBe(format);
  });

  it("rejects any other format", () => {
    const result = exportScheduleSchema.safeParse({ format: "xlsx" });
    expect(errorFor(result, "format")).toBe("Format must be csv or pdf");
  });
});
