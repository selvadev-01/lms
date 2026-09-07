import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { trim } from '../../common/transforms/trim';

/**
 * Report query shapes.
 *
 * # Why `branchId` is present here when Module 14's ledger DTO omits it
 *
 * Module 14 leaves the field off entirely, so that `forbidNonWhitelisted` makes
 * a cross-branch ledger read structurally unconstructible. That is the stronger
 * guarantee and it is right for a ledger, which a branch user reads only for
 * their own branch.
 *
 * Module 15 cannot do the same, because an organization-wide user legitimately
 * needs to run a report *for one branch* — comparing branches is most of what
 * an organization-level report is for. So the field exists, and the refusal
 * moves from "the request cannot be expressed" to "the server decides".
 * `resolveBranchScope` in `report-scope.ts` is where that decision lives: a
 * branch-confined caller naming another branch is refused, never silently
 * served their own data under the other branch's heading (Scenario 11).
 *
 * # Nothing else about scope is accepted
 *
 * There is no `orgId` on any DTO in this module. The organization comes from
 * the JWT, which is what makes Scenario 54 — cross-organization access denied —
 * true by construction rather than by a check.
 *
 * # These validate shape; `report-scope.ts` validates meaning
 *
 * A date matches `YYYY-MM-DD` here. Whether the pair is ordered and within the
 * configured span is a cross-field rule, checked server-side in
 * `assertDateRange` so that it holds for a caller who never loaded the web app.
 */

const REPORT_CATEGORIES = [
  'DASHBOARD',
  'PORTFOLIO',
  'APPLICATIONS',
  'DISBURSALS',
  'COLLECTIONS',
  'FIELD_COLLECTIONS',
  'OVERDUE_RECOVERY',
  'FINANCIAL',
] as const;

const REPORT_DATE_BASES = [
  'APPLICATION_DATE',
  'DISBURSAL_DATE',
  'DUE_DATE',
  'COLLECTION_DATE',
  'ACCOUNTING_DATE',
  'BUSINESS_DATE',
] as const;

/**
 * The filters every tabular report accepts.
 *
 * `fromDate` and `toDate` are optional at this layer and required by the
 * services that need a range — the dashboard's portfolio KPIs are as-of-now
 * positions and take no range at all, so requiring one here would force a
 * meaningless date onto a request that has no use for it.
 */
export class ReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date must be a valid date' })
  fromDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To Date must be a valid date' })
  toDate?: string;

  @IsOptional()
  @IsEnum(REPORT_DATE_BASES, { message: 'Date Basis is not supported' })
  dateBasis?: (typeof REPORT_DATE_BASES)[number];

  /**
   * The branch to report on. A request, not an instruction — see the note at
   * the top of this file.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  /**
   * One borrower's rows, for the customer portfolio.
   *
   * A **filter, not a scope** — the same distinction `branchId` above carries.
   * The org and branch clauses are applied unconditionally in the service
   * whatever this says, so a customer id can only narrow what a caller already
   * sees. Naming a customer in another branch matches nothing rather than
   * reaching them, which also means it cannot be used to probe who exists.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Select a valid customer' })
  customerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** A report query that also names a file format. */
export class ReportExportQueryDto extends ReportQueryDto {
  @IsOptional()
  @IsEnum(['csv', 'pdf'], { message: 'Format must be csv or pdf' })
  format?: 'csv' | 'pdf';
}

/**
 * The dashboard query.
 *
 * Separate from `ReportQueryDto` because a dashboard has no pagination and no
 * free-text search — it is a fixed set of KPIs, not a list.
 */
export class DashboardQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date must be a valid date' })
  fromDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To Date must be a valid date' })
  toDate?: string;

  @IsOptional()
  @IsEnum(REPORT_DATE_BASES, { message: 'Date Basis is not supported' })
  dateBasis?: (typeof REPORT_DATE_BASES)[number];

  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;
}

/**
 * The financial report query.
 *
 * `accountId` is optional here where Module 14's ledger requires it: the
 * financial *report* is a period view across accounts, which is what Scenario
 * 24 asks for, while the ledger screen is one account's running balance. The
 * date range is what bounds this query instead, and `assertDateRange` makes
 * that bound mandatory.
 */
export class FinancialReportQueryDto extends ReportQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Select a valid account' })
  accountId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(50)
  sourceType?: string;
}

export { REPORT_CATEGORIES, REPORT_DATE_BASES };
