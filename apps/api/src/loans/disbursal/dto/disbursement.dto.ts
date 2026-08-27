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
 * Module 09 — disbursal DTOs.
 *
 * Follows `loan-application.dto.ts` in all three of its conventions, and one
 * of them matters more here than anywhere else in the codebase:
 *
 * **`@ValidateIf` is never used on a required field.** It skips `@IsNotEmpty`
 * and silently accepts a missing value. The one rule that tempts it —
 * "transaction reference is required for a bank transfer" (Rule 11, Scenario
 * 16) — is therefore enforced in the service against the resolved payment
 * mode, and in the shared zod schema at the object level, never by a
 * conditional decorator on the field.
 *
 * **No scope fields, and no amount on the schedule.** The disbursement amount
 * is read from the sanction letter server-side. `RecordTransferDto` carries one
 * only so a mismatch can be reported (Scenario 6); `forbidNonWhitelisted` turns
 * an attempt to send one anywhere else into a 400.
 */

/** `YYYY-MM-DD`. Existence is checked in the service, not by the pattern. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ScheduleDisbursementDto {
  @IsUUID('4', { message: 'Select a loan to disburse' })
  applicationId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Disbursement Date is required' })
  @Matches(ISO_DATE, { message: 'Disbursement Date must be a valid date' })
  disbursementDate!: string;

  @IsUUID('4', { message: 'Disbursement Account is required' })
  disbursementAccountId!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  notes?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Edit a schedule before any transfer.
 *
 * No `applicationId`: re-targeting a schedule at a different loan is a cancel
 * and a re-schedule, not an edit. Allowing it here would let one loan's
 * approved terms fund another.
 */
export class UpdateDisbursementScheduleDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Disbursement Date is required' })
  @Matches(ISO_DATE, { message: 'Disbursement Date must be a valid date' })
  disbursementDate!: string;

  @IsUUID('4', { message: 'Disbursement Account is required' })
  disbursementAccountId!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  notes?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class RecordTransferDto {
  @IsIn(['CASH', 'UPI', 'BANK_TRANSFER'], {
    message: 'Transfer Method is required',
  })
  paymentMode!: 'CASH' | 'UPI' | 'BANK_TRANSFER';

  /**
   * Compared against the sanctioned amount, never used as the amount.
   * A mismatch is refused (Scenario 6); the posted figure is the sanction's.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Amount is required' })
  @Matches(/^\d+$/, { message: 'Amount must be a whole number of paise' })
  @MaxLength(19, { message: 'Amount is too large' })
  amountPaise!: string;

  /**
   * Optional at this layer because cash has no external system to reference.
   * Whether it is required is a function of `paymentMode`, which the service
   * decides — see the class comment on why not `@ValidateIf`.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, {
    message:
      'Transaction Reference may use letters, digits, hyphen, underscore and slash only',
  })
  @MaxLength(150, {
    message: 'Transaction Reference must be 150 characters or fewer',
  })
  transactionReference?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Transfer Date is required' })
  @Matches(ISO_DATE, { message: 'Transfer Date must be a valid date' })
  transferDate!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Confirm — the irreversible one.
 *
 * `idempotencyKey` is required and client-minted. It is what lets a retry after
 * a network timeout return the original result rather than move money twice
 * (Scenarios 28, 46), and it must be minted once per form rather than per
 * submit: a key regenerated on retry defeats the mechanism entirely.
 */
export class ConfirmDisbursementDto {
  @IsUUID('4', { message: 'A valid idempotency key is required' })
  idempotencyKey!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class FailDisbursementDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Failure Reason is required' })
  @MaxLength(1000, {
    message: 'Failure Reason must be 1000 characters or fewer',
  })
  failureReason!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class CancelDisbursementDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Cancellation Reason is required' })
  @MaxLength(1000, {
    message: 'Cancellation Reason must be 1000 characters or fewer',
  })
  cancellationReason!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * The list filter.
 *
 * Deliberately has no `branchId`. A caller's branch comes from the JWT, and the
 * absence of the parameter is what makes Scenario 3 structural rather than a
 * check the list query has to remember.
 */
export class ListDisbursementsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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
