import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Module 13 — overdue read DTOs.
 *
 * **Nothing here decides scope, and nothing here is a money figure.**
 *
 * There is no `branchId` and no `orgId`: both come from the JWT and are applied
 * server-side, so a caller cannot read another branch's overdue book
 * (Scenarios 1, 45, 47). There is no `asOfDate` either — the business date is
 * the server's Asia/Kolkata clock, and accepting one from a client would let a
 * wrong device clock move a borrower into or out of the overdue book, which is
 * precisely what Rule 14 forbids.
 *
 * `forbidNonWhitelisted` in `main.ts` turns an attempt to send any of them into
 * a 400 rather than a silent ignore.
 */

const DELINQUENCY_BUCKETS = [
  'CURRENT',
  'DPD_1_30',
  'DPD_31_60',
  'DPD_61_90',
  'DPD_91_180',
  'DPD_180_PLUS',
] as const;

const NPA_STATUSES = [
  'STANDARD',
  'SPECIAL_MENTION',
  'SUB_STANDARD',
  'DOUBTFUL',
  'LOSS',
] as const;

export class ListOverdueDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  search?: string;

  /**
   * Filters on a *derived* value.
   *
   * The bucket is computed per row rather than stored, so this cannot become a
   * SQL predicate — the service applies it after the derivation. Documented
   * here because a reader who assumed it was indexed would be surprised by the
   * query plan.
   */
  @IsOptional()
  @IsIn(DELINQUENCY_BUCKETS, { message: 'Unknown delinquency bucket' })
  bucket?: (typeof DELINQUENCY_BUCKETS)[number];

  /** Also derived. Matches `OverdueSummary.npaEligibility`, not a stored column. */
  @IsOptional()
  @IsIn(NPA_STATUSES, { message: 'Unknown NPA status' })
  npaStatus?: (typeof NPA_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDaysPastDue?: number;

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
