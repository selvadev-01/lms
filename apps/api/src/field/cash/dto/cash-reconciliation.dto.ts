import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
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
 * Module 12 — cash reconciliation DTOs.
 *
 * **These, not the zod schemas, are what guard the API.**
 *
 * **No derived figure is accepted.** There is no `expectedCashPaise`,
 * `differencePaise` or `status` below. The expected side is copied from what
 * the branch recorded receiving and the difference is computed from the two —
 * a client-supplied difference would let a reconciliation assert a match it
 * never counted, which is the one thing this table exists to prevent.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Integer paise. Never a number — a float would round a paisa away silently. */
const PAISE = /^\d+$/;

const DISCREPANCY_TYPES = [
  'SHORTAGE',
  'EXCESS',
  'COUNTERFEIT',
  'DAMAGED_NOTES',
  'DISPUTED_COLLECTION',
  'OTHER',
] as const;

const RESOLUTION_ACTIONS = [
  'RECOVERED_FROM_AGENT',
  'WRITTEN_OFF',
  'ADJUSTED_NEXT_HANDOVER',
  'ESCALATED',
  'NO_ACTION',
] as const;

/**
 * Count the cash against a received handover.
 *
 * `actualCashPaise` is the physical count and the only figure supplied.
 */
export class CreateReconciliationDto {
  @IsUUID('4', { message: 'Handover is required' })
  handoverId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Actual Cash Counted is required' })
  @Matches(PAISE, {
    message: 'Actual Cash Counted must be a whole number of paise',
  })
  @MaxLength(19, { message: 'Actual Cash Counted is too large' })
  actualCashPaise!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  notes?: string;

  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;
}

/**
 * Resolve a pending shortage or excess.
 *
 * Every field except the notes and the approval reference is required, because
 * Rule 35 says a discrepancy "requires a recorded reason and an authorized
 * resolution" — and an optional reason is how that becomes a blank one.
 *
 * `approvalReference` stays optional because several resolutions legitimately
 * post nothing: `NO_ACTION` and `ESCALATED` most obviously. When an adjustment
 * *was* posted, this carries the Module 14 journal entry number — this module
 * writes no journal of its own (Scenario 29).
 */
export class ResolveDiscrepancyDto {
  @IsIn(DISCREPANCY_TYPES, { message: 'Discrepancy Type is required' })
  discrepancyType!: (typeof DISCREPANCY_TYPES)[number];

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(1000, { message: 'Reason is too long' })
  discrepancyReason!: string;

  @IsIn(RESOLUTION_ACTIONS, { message: 'Resolution Action is required' })
  resolutionAction!: (typeof RESOLUTION_ACTIONS)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  resolutionNotes?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150, { message: 'Approval Reference is too long' })
  approvalReference?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class ListReconciliationsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['PENDING', 'MATCHED', 'DISCREPANCY_PENDING', 'RESOLVED'])
  status?: 'PENDING' | 'MATCHED' | 'DISCREPANCY_PENDING' | 'RESOLVED';

  @IsOptional()
  @IsIn(DISCREPANCY_TYPES)
  discrepancyType?: (typeof DISCREPANCY_TYPES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(ISO_DATE, { message: 'From Date must be a valid date' })
  fromDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(ISO_DATE, { message: 'To Date must be a valid date' })
  toDate?: string;

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
