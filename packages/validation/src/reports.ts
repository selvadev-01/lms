import { z } from "zod";

import { optionsFrom } from "./options";
import { isoDateSchema, optionalText } from "./primitives";

/**
 * Module 15 schemas — reports and analytics.
 *
 * Same cycle-avoiding rule as every other module file: imports reach `./loans`,
 * `./options` and `./primitives` directly, never `./index`.
 *
 * Four things are specific to this module.
 *
 * **Nothing that decides scope is accepted from the client.** There is no
 * `orgId` here, and `branchId` is accepted only as a *request* that the server
 * is free to narrow or refuse. The organization comes from the JWT and the
 * branch from the actor's scope. Rule 4 and Scenario 11 both turn on this: a
 * client-supplied branch must never widen what the caller can read.
 *
 * **Every report declares one date basis.** Rule 10 requires it and Rule 11
 * forbids mixing two, so the range is validated here and the *permitted* bases
 * per category are enforced by `reportRequestSchema` rather than left to each
 * screen. An application report filtered by disbursal date would silently drop
 * every application that was never disbursed.
 *
 * **The range is bounded.** Rule 32 requires a configured limit so that one
 * request cannot execute an unbounded query (Scenario 62). `MAX_DATE_RANGE_DAYS`
 * is checked in the same `.superRefine` as `fromDate <= toDate`, because both
 * are cross-field rules and a caller fixing one wants to hear about the other.
 *
 * **These schemas run in the browser.** They are not what guards the API — the
 * DTOs are. A rule written only here is enforced only here, which is why the
 * API's report DTOs re-express these same bounds rather than importing a
 * `.parse` and calling it validation.
 */

// --- Enums -------------------------------------------------------------------

/**
 * The nine report categories.
 *
 * Deliberately not the database's older `report_type` enum, which mixes a
 * period (`WEEKLY`) with a subject (`LOAN`) with an audience (`BRANCH`) and
 * cannot express "overdue and recovery" at all.
 */
export const reportCategorySchema = z.enum(
  [
    "DASHBOARD",
    "PORTFOLIO",
    "APPLICATIONS",
    "DISBURSALS",
    "COLLECTIONS",
    "FIELD_COLLECTIONS",
    "OVERDUE_RECOVERY",
    "FINANCIAL",
  ],
  { required_error: "Report Type is required" },
);

export const REPORT_CATEGORY_OPTIONS = optionsFrom(
  reportCategorySchema.options,
  {
    DASHBOARD: "Dashboard",
    PORTFOLIO: "Loan Portfolio",
    APPLICATIONS: "Applications",
    DISBURSALS: "Disbursal",
    COLLECTIONS: "Repayment & Collections",
    FIELD_COLLECTIONS: "Field Collection & Reconciliation",
    OVERDUE_RECOVERY: "Overdue & Recovery",
    FINANCIAL: "Financial",
  },
);

/**
 * The date column a range filter is applied to.
 *
 * The message is on the enum rather than on a `.min(1)` because an untouched
 * `<select>` posts `""`, which is a value the enum rejects — the same reasoning
 * Module 14's account-type schema documents.
 */
export const reportDateBasisSchema = z.enum(
  [
    "APPLICATION_DATE",
    "DISBURSAL_DATE",
    "DUE_DATE",
    "COLLECTION_DATE",
    "ACCOUNTING_DATE",
    "BUSINESS_DATE",
  ],
  { required_error: "Date Basis is required" },
);

export const REPORT_DATE_BASIS_OPTIONS = optionsFrom(
  reportDateBasisSchema.options,
  {
    APPLICATION_DATE: "Application Date",
    DISBURSAL_DATE: "Disbursal Date",
    DUE_DATE: "EMI Due Date",
    COLLECTION_DATE: "Collection Date",
    ACCOUNTING_DATE: "Accounting Business Date",
    BUSINESS_DATE: "Business Date",
  },
);

export const reportExportFormatSchema = z.enum(["CSV", "PDF"], {
  required_error: "Format is required",
});

export const REPORT_EXPORT_FORMAT_OPTIONS = optionsFrom(
  reportExportFormatSchema.options,
  { CSV: "CSV (Excel)", PDF: "PDF" },
);

export const reportVisibilitySchema = z.enum(["PRIVATE", "SHARED"], {
  required_error: "Visibility is required",
});

export const REPORT_VISIBILITY_OPTIONS = optionsFrom(
  reportVisibilitySchema.options,
  {
    PRIVATE: "Private — only me",
    SHARED: "Shared — anyone authorized in this organization",
  },
);

// --- Limits ------------------------------------------------------------------

/**
 * Bounds on a single request.
 *
 * Duplicated from `@lms/constants` rather than imported: this package is a leaf
 * that both the API and the web depend on, and taking a dependency on the
 * constants package to read two numbers would invert that. The catalogue test
 * pins the two copies together.
 */
export const MAX_DATE_RANGE_DAYS = 366;
export const MAX_EXPORT_ROWS = 10_000;

/** Which bases each category permits. Anything else is refused (Scenario 10). */
export const PERMITTED_DATE_BASES = {
  DASHBOARD: ["COLLECTION_DATE", "DISBURSAL_DATE"],
  PORTFOLIO: ["DISBURSAL_DATE"],
  APPLICATIONS: ["APPLICATION_DATE"],
  DISBURSALS: ["DISBURSAL_DATE"],
  COLLECTIONS: ["COLLECTION_DATE"],
  FIELD_COLLECTIONS: ["BUSINESS_DATE"],
  OVERDUE_RECOVERY: ["DUE_DATE"],
  FINANCIAL: ["ACCOUNTING_DATE"],
} as const satisfies Record<
  z.infer<typeof reportCategorySchema>,
  readonly z.infer<typeof reportDateBasisSchema>[]
>;

// --- Request -----------------------------------------------------------------

const dateRangeFields = {
  fromDate: isoDateSchema("From Date"),
  toDate: isoDateSchema("To Date"),
};

/**
 * Whole days between two ISO dates, inclusive of both ends.
 *
 * Both are parsed at noon UTC, the same trick `isoDateSchema` uses, so that a
 * daylight-saving boundary cannot shift a date across midnight and change the
 * count by one.
 */
function inclusiveDaySpan(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T12:00:00Z`).getTime();
  const to = new Date(`${toDate}T12:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * The two cross-field rules every dated report obeys.
 *
 * Written as a reusable function rather than a `.superRefine` on a base schema
 * that other schemas then `.extend()`: extending a refined schema silently drops
 * its refinements, so a rule attached once at the bottom would stop being
 * enforced the moment a category added a filter. Applying it explicitly at each
 * leaf is more typing and cannot rot.
 */
function refineDateRange(
  value: { fromDate: string; toDate: string },
  ctx: z.RefinementCtx,
): void {
  if (value.fromDate > value.toDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toDate"],
      message: "To Date must be on or after From Date",
    });
    return;
  }

  if (inclusiveDaySpan(value.fromDate, value.toDate) > MAX_DATE_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toDate"],
      message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
    });
  }
}

/**
 * A report request.
 *
 * `branchId` is optional and is a *request*, not an instruction: the server
 * narrows it to the caller's scope or refuses it. `organizationId` is absent by
 * design — the mandatory-field table names Organization, but it comes from the
 * JWT, so a report can never be run for an organization the caller is not in.
 */
export const reportRequestSchema = z
  .object({
    category: reportCategorySchema,
    dateBasis: reportDateBasisSchema,
    ...dateRangeFields,
    branchId: z.string().uuid("Select a valid branch").optional(),
    search: optionalText(120),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx);

    const permitted: readonly string[] = PERMITTED_DATE_BASES[value.category];
    if (!permitted.includes(value.dateBasis)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateBasis"],
        message: `This report cannot be filtered by that date basis`,
      });
    }
  });

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;

/** A report request that also names a file format. */
export const reportExportRequestSchema = z
  .object({
    category: reportCategorySchema,
    dateBasis: reportDateBasisSchema,
    ...dateRangeFields,
    branchId: z.string().uuid("Select a valid branch").optional(),
    search: optionalText(120),
    format: reportExportFormatSchema,
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx);

    const permitted: readonly string[] = PERMITTED_DATE_BASES[value.category];
    if (!permitted.includes(value.dateBasis)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateBasis"],
        message: `This report cannot be filtered by that date basis`,
      });
    }
  });

export type ReportExportRequestInput = z.infer<
  typeof reportExportRequestSchema
>;

// --- Saved reports -----------------------------------------------------------

/**
 * A saved report definition.
 *
 * The stored branch scope is validated here for shape only. What it *means* is
 * decided when the report runs, against the runner's live authorization —
 * Rules 4 and 27, and Scenario 43. A definition saved by an organization-wide
 * user and run by a branch user yields that branch's rows, not everything.
 */
export const saveReportSchema = z
  .object({
    name: z
      .string({ required_error: "Report Name is required" })
      .trim()
      .min(1, "Report Name is required")
      .max(150, "Report Name must be 150 characters or fewer"),
    category: reportCategorySchema,
    visibility: reportVisibilitySchema,
    dateBasis: reportDateBasisSchema,
    ...dateRangeFields,
    branchId: z.string().uuid("Select a valid branch").optional(),
    search: optionalText(120),
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx);

    const permitted: readonly string[] = PERMITTED_DATE_BASES[value.category];
    if (!permitted.includes(value.dateBasis)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateBasis"],
        message: `This report cannot be filtered by that date basis`,
      });
    }
  });

export type SaveReportInput = z.infer<typeof saveReportSchema>;

/**
 * Editing a saved report.
 *
 * Carries `expectedVersion` so a stale edit is refused rather than silently
 * overwriting a newer definition (Scenario 59). Written as its own object
 * rather than `saveReportSchema.extend(...)`, because `.extend` is only
 * available on an unrefined object and reaching for `.innerType()` to get one
 * would drop every cross-field rule above.
 */
export const updateSavedReportSchema = z
  .object({
    name: z
      .string({ required_error: "Report Name is required" })
      .trim()
      .min(1, "Report Name is required")
      .max(150, "Report Name must be 150 characters or fewer"),
    category: reportCategorySchema,
    visibility: reportVisibilitySchema,
    dateBasis: reportDateBasisSchema,
    ...dateRangeFields,
    branchId: z.string().uuid("Select a valid branch").optional(),
    search: optionalText(120),
    expectedVersion: z.coerce
      .number({ required_error: "Version is required" })
      .int()
      .min(1),
  })
  .superRefine((value, ctx) => {
    refineDateRange(value, ctx);

    const permitted: readonly string[] = PERMITTED_DATE_BASES[value.category];
    if (!permitted.includes(value.dateBasis)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateBasis"],
        message: `This report cannot be filtered by that date basis`,
      });
    }
  });

export type UpdateSavedReportInput = z.infer<typeof updateSavedReportSchema>;

/** Deactivating a saved report. Deactivation is the normal end of life, not deletion. */
export const deactivateSavedReportSchema = z.object({
  expectedVersion: z.coerce
    .number({ required_error: "Version is required" })
    .int()
    .min(1),
});

export type DeactivateSavedReportInput = z.infer<
  typeof deactivateSavedReportSchema
>;
