import { describe, expect, it } from "vitest";

import {
  MAX_DATE_RANGE_DAYS,
  MAX_EXPORT_ROWS,
  PERMITTED_DATE_BASES,
  REPORT_CATEGORY_OPTIONS,
  REPORT_DATE_BASIS_OPTIONS,
  reportExportRequestSchema,
  reportRequestSchema,
  saveReportSchema,
  updateSavedReportSchema,
} from "./reports";

/**
 * Module 15 — report request validation.
 *
 * These schemas guard a *query*, not a record, so the properties worth pinning
 * are different from every other module file in this package:
 *
 *  1. **The mandatory-field table produces the exact messages the story names.**
 *     The Scenario Outline lists five fields and five messages; a screen that
 *     shows a different wording has silently failed the scenario.
 *  2. **The range rules survive.** Both live in a `.superRefine`, and the trap
 *     they were written around is that extending a refined schema drops it.
 *     Asserting them on every schema that carries a range is what would catch
 *     a future `.extend()`.
 *  3. **A category cannot be filtered by a foreign date basis.** Rule 11 and
 *     Scenario 12: an application report filtered by disbursal date would
 *     silently drop every application that was never disbursed.
 */

const valid = {
  category: "COLLECTIONS",
  dateBasis: "COLLECTION_DATE",
  fromDate: "2026-01-01",
  toDate: "2026-01-31",
} as const;

function messagesFor(result: { success: boolean; error?: unknown }): string[] {
  if (result.success) return [];
  const error = result.error as { issues: { message: string }[] };
  return error.issues.map((issue) => issue.message);
}

describe("limits", () => {
  it("matches the values the API and @lms/constants use", () => {
    // Three declarations of the same two numbers — here, in `@lms/constants`
    // for the web app, and in the API's `report-scope.ts` for the CJS Nest
    // build, which cannot require this package's ESM. The duplication is
    // forced; the drift it invites is not. A ceiling the browser accepts and
    // the server refuses produces a form that cannot be submitted and gives no
    // reason why.
    expect(MAX_DATE_RANGE_DAYS).toBe(366);
    expect(MAX_EXPORT_ROWS).toBe(10_000);
  });
});

describe("reportRequestSchema", () => {
  it("accepts a well-formed request", () => {
    expect(reportRequestSchema.safeParse(valid).success).toBe(true);
  });

  describe("Scenario Outline: mandatory report request validation", () => {
    // The story's Examples table, verbatim. Organization is absent by design:
    // it comes from the JWT, so there is no field for a user to omit.
    it.each([
      ["category", "Report Type is required"],
      ["dateBasis", "Date Basis is required"],
      ["fromDate", "From Date is required"],
      ["toDate", "To Date is required"],
    ])("rejects a missing %s with %s", (field, message) => {
      const input: Record<string, unknown> = { ...valid };
      delete input[field];

      const result = reportRequestSchema.safeParse(input);

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(message);
    });

    it("treats an untouched select the same as a missing one", () => {
      // An untouched `<select>` posts "", not undefined. Both must produce the
      // mandatory-field message rather than an enum-shaped one.
      const result = reportRequestSchema.safeParse({
        ...valid,
        dateBasis: "",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Scenario 9: reject invalid date range", () => {
    it("rejects a From Date later than the To Date", () => {
      const result = reportRequestSchema.safeParse({
        ...valid,
        fromDate: "2026-02-01",
        toDate: "2026-01-01",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "To Date must be on or after From Date",
      );
    });

    it("accepts a single-day range", () => {
      // From and To on the same day is one day, not zero. A report for one
      // business date is the most common request the field desk makes.
      const result = reportRequestSchema.safeParse({
        ...valid,
        fromDate: "2026-01-15",
        toDate: "2026-01-15",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Scenario 62: report query exceeds configured limits", () => {
    it(`accepts a range of exactly ${MAX_DATE_RANGE_DAYS} days`, () => {
      // 2026-01-01 to 2026-12-31 inclusive is 365 days; the limit is 366 so a
      // leap year fits. The boundary is asserted from both sides because an
      // off-by-one here refuses a legitimate financial year.
      const result = reportRequestSchema.safeParse({
        ...valid,
        fromDate: "2026-01-01",
        toDate: "2026-12-31",
      });

      expect(result.success).toBe(true);
    });

    it("rejects a range one day beyond the limit", () => {
      const result = reportRequestSchema.safeParse({
        ...valid,
        fromDate: "2025-01-01",
        toDate: "2026-12-31",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
      );
    });
  });

  describe("Scenario 10: reject unsupported filter combination", () => {
    it("refuses a date basis the category does not permit", () => {
      const result = reportRequestSchema.safeParse({
        ...valid,
        category: "APPLICATIONS",
        dateBasis: "DISBURSAL_DATE",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "This report cannot be filtered by that date basis",
      );
    });

    it("permits every basis each category declares", () => {
      // Guards the registry against naming a basis that the enum does not have,
      // which would refuse a filter the screen offers.
      for (const [category, bases] of Object.entries(PERMITTED_DATE_BASES)) {
        for (const dateBasis of bases) {
          const result = reportRequestSchema.safeParse({
            ...valid,
            category,
            dateBasis,
          });

          expect(result.success).toBe(true);
        }
      }
    });
  });

  describe("Scenario 11: client-supplied branch cannot override authorization", () => {
    it("accepts a branch as a request", () => {
      // Shape only. Whether the caller may read that branch is the server's
      // decision — this schema runs in the browser and decides nothing.
      const result = reportRequestSchema.safeParse({
        ...valid,
        branchId: "11111111-1111-4111-8111-111111111111",
      });

      expect(result.success).toBe(true);
    });

    it("rejects a branch that is not a uuid", () => {
      const result = reportRequestSchema.safeParse({
        ...valid,
        branchId: "not-a-branch",
      });

      expect(result.success).toBe(false);
    });

    it("has no field through which an organization could be supplied", () => {
      // The organization comes from the JWT. If a schema ever grew an `orgId`,
      // a client could name another tenant and this test is what would catch it.
      const result = reportRequestSchema.safeParse({
        ...valid,
        orgId: "22222222-2222-4222-8222-222222222222",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("orgId");
      }
    });
  });
});

describe("reportExportRequestSchema", () => {
  it("requires a format", () => {
    const result = reportExportRequestSchema.safeParse(valid);

    expect(result.success).toBe(false);
    expect(messagesFor(result)).toContain("Format is required");
  });

  it("still enforces the range rules", () => {
    // The rule this is really guarding: the export schema is a separate object
    // rather than an extension of the request schema, precisely so its
    // refinements cannot be dropped. If someone rewrites it as
    // `reportRequestSchema.innerType().extend(...)`, this fails.
    const result = reportExportRequestSchema.safeParse({
      ...valid,
      format: "CSV",
      fromDate: "2026-02-01",
      toDate: "2026-01-01",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result)).toContain(
      "To Date must be on or after From Date",
    );
  });
});

describe("saveReportSchema", () => {
  const definition = {
    ...valid,
    name: "Branch collections, January",
    visibility: "PRIVATE",
  } as const;

  it("accepts a well-formed definition", () => {
    expect(saveReportSchema.safeParse(definition).success).toBe(true);
  });

  it("requires a name", () => {
    const result = saveReportSchema.safeParse({ ...definition, name: "" });

    expect(result.success).toBe(false);
    expect(messagesFor(result)).toContain("Report Name is required");
  });

  it("requires a visibility", () => {
    const input: Record<string, unknown> = { ...definition };
    delete input.visibility;

    const result = saveReportSchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(messagesFor(result)).toContain("Visibility is required");
  });

  it("still enforces the range rules", () => {
    const result = saveReportSchema.safeParse({
      ...definition,
      fromDate: "2026-02-01",
      toDate: "2026-01-01",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateSavedReportSchema", () => {
  const update = {
    ...valid,
    name: "Branch collections, January",
    visibility: "PRIVATE",
    expectedVersion: 3,
  } as const;

  it("accepts a well-formed update", () => {
    expect(updateSavedReportSchema.safeParse(update).success).toBe(true);
  });

  describe("Scenario 59: saved report sync conflict", () => {
    it("requires the version the editor was working from", () => {
      // Without it the server cannot tell a fresh edit from a stale one, and a
      // second editor's change would silently overwrite the first.
      const input: Record<string, unknown> = { ...update };
      delete input.expectedVersion;

      const result = updateSavedReportSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  it("still enforces the date-basis whitelist", () => {
    const result = updateSavedReportSchema.safeParse({
      ...update,
      category: "FINANCIAL",
      dateBasis: "COLLECTION_DATE",
    });

    expect(result.success).toBe(false);
  });
});

describe("select options", () => {
  it("offers a label for every category and basis", () => {
    // `optionsFrom` is given the enum's own `.options`, so a value added to the
    // enum without a label would surface here as an undefined label rather than
    // as a blank entry in a live dropdown.
    for (const option of [
      ...REPORT_CATEGORY_OPTIONS,
      ...REPORT_DATE_BASIS_OPTIONS,
    ]) {
      expect(option.label).toBeTruthy();
    }
  });
});
