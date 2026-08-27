import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * General ledger, trial balance and reconciliation query shapes.
 *
 * **No `branchId` on any of them.** Branch confinement comes from the actor's
 * scope, and the absence of the field plus the global `forbidNonWhitelisted` is
 * what makes Scenario 34 structural rather than a filter somebody has to
 * remember to apply. There is no request a client can construct that reads
 * another branch's ledger.
 */

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

/**
 * A general-ledger query.
 *
 * `accountId` is required, and that is a design decision rather than an
 * omission. A ledger with no account filter is a journal listing, which
 * `GET /accounting/journals` already is; requiring it also bounds a query that
 * would otherwise scan every posted line in the organization.
 */
export class GeneralLedgerQueryDto {
  @IsUUID('4', { message: 'Account is required' })
  accountId!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date must be a valid date' })
  fromDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To Date must be a valid date' })
  toDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(50)
  sourceType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class TrialBalanceQueryDto {
  /** Defaults to today's Asia/Kolkata business date. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'As Of Date must be a valid date',
  })
  asOfDate?: string;

  /**
   * Narrows to movement within a period rather than balances since inception.
   *
   * Omitted, the trial balance is cumulative, which is what "trial balance"
   * ordinarily means.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date must be a valid date' })
  fromDate?: string;

  /**
   * Include accounts whose balance is zero.
   *
   * Off by default: a chart of accounts is mostly zeroes on any given day, and
   * a report that is mostly zeroes hides the rows that matter.
   */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeZero?: boolean;
}

/**
 * The reconciliation window.
 *
 * Both dates are required, unlike the other two queries. Reconciliation reads
 * every source transaction in the range and cross-checks it against every
 * journal; an unbounded run would be a full-table scan of the two largest
 * tables in the system, and "reconcile everything since inception" is not a
 * question anyone asks by accident.
 */
export class ReconciliationQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date is required' })
  fromDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To Date is required' })
  toDate!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(50)
  sourceType?: string;
}
