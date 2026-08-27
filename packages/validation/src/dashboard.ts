import { z } from "zod";

import { optionsFrom } from "./options";
import { isoDateSchema } from "./primitives";

/**
 * Module 18 schemas — the dashboard's period and scope filter.
 *
 * Same cycle-avoiding rule as every other module file: imports reach `./options`
 * and `./primitives` directly, never `./index`.
 *
 * This file is small, and three of its absences carry more weight than what it
 * contains.
 *
 * **There is no `organizationId`, and no `businessDate`.** The organization
 * comes from the JWT. The business date is derived on the server from
 * Asia/Kolkata (Rules 15-16), for the reason the overdue book documents: a
 * wrong device clock must not be able to move a borrower into or out of the
 * overdue book. The specification's mandatory-field table lists "Business Date
 * is required for this view", and that row is satisfied *inverted* — the field
 * is not accepted, so it can never be missing.
 *
 * **`branchId` is a request, not an instruction.** The server narrows it to the
 * caller's scope or refuses it outright (Scenario 7). A client-supplied branch
 * can never widen what the caller reads.
 *
 * **There is no schema for a widget's data.** The dashboard writes nothing —
 * Rules 10, 33, 44 and 47 make it a read and navigation layer, and there is no
 * form anywhere in the module. A schema here would describe a path that does
 * not exist.
 *
 * **These schemas run in the browser.** They are not what guards the API — the
 * DTOs are. A rule written only here is enforced only here, which is why the
 * API's dashboard DTO re-expresses these same bounds rather than importing a
 * `.parse` and calling it validation.
 */

// --- Enums -------------------------------------------------------------------

/**
 * The period a range-bounded widget is filtered to.
 *
 * The message is on the enum rather than on a `.min(1)` because an untouched
 * `<select>` posts `""`, which is a value the enum rejects — the same reasoning
 * Module 14's account-type schema and Module 15's date-basis schema document.
 */
export const dashboardPeriodTypeSchema = z.enum(
  ["TODAY", "THIS_WEEK", "THIS_MONTH", "CUSTOM"],
  { required_error: "Period is required" },
);

export const DASHBOARD_PERIOD_TYPE_OPTIONS = optionsFrom(
  dashboardPeriodTypeSchema.options,
  {
    TODAY: "Today",
    THIS_WEEK: "This Week",
    THIS_MONTH: "This Month",
    CUSTOM: "Custom Date Range",
  },
);

// --- Limits ------------------------------------------------------------------

/**
 * Bound on a custom range.
 *
 * Duplicated from `@lms/constants` for the same reason `./reports` duplicates
 * it: this package is a leaf that both the API and the web depend on, and
 * taking a dependency on the constants package to read one number would invert
 * that. Deliberately the same 366 days a report permits — a dashboard that
 * allowed a wider range than the report it drills into would produce a KPI no
 * report could reconcile, and Rule 42 sends anything larger to the reporting
 * path anyway.
 */
export const MAX_DASHBOARD_RANGE_DAYS = 366;

// --- Request -----------------------------------------------------------------

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
 * The dashboard's period and scope filter.
 *
 * `fromDate` and `toDate` are optional at the field level and *conditionally
 * required* by the refinement below, because they are meaningless for the three
 * preset periods — the server derives those from the business date. Making them
 * unconditionally required would force a screen to post dates it does not have
 * and the server would ignore.
 *
 * The conditional requirement is written in `.superRefine` rather than with
 * `@ValidateIf`-style conditional presence, and the whole rule lives at this
 * leaf rather than on a base schema other schemas extend: extending a refined
 * schema silently drops its refinements, so a rule attached once at the bottom
 * would stop being enforced the moment something extended it.
 */
export const dashboardFilterSchema = z
  .object({
    periodType: dashboardPeriodTypeSchema.optional(),
    fromDate: isoDateSchema("Period Start Date").optional(),
    toDate: isoDateSchema("Period End Date").optional(),
    branchId: z.string().uuid("Select a valid branch").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.periodType !== "CUSTOM") {
      return;
    }

    // Scenario Outline: a custom range names both ends or neither is usable.
    if (!value.fromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromDate"],
        message: "Period Start Date is required",
      });
    }

    if (!value.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toDate"],
        message: "Period End Date is required",
      });
    }

    if (!value.fromDate || !value.toDate) {
      return;
    }

    // Scenario 5: an inverted range is refused, and the previous valid state
    // stays available because nothing was applied.
    if (value.fromDate > value.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toDate"],
        message: "Period End Date must be on or after Period Start Date",
      });
      return;
    }

    if (
      inclusiveDaySpan(value.fromDate, value.toDate) > MAX_DASHBOARD_RANGE_DAYS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toDate"],
        message: `Date range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days`,
      });
    }
  });

export type DashboardFilterInput = z.infer<typeof dashboardFilterSchema>;
