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
 * Module 12 — cash handover DTOs.
 *
 * **These, not the zod schemas, are what guard the API.**
 *
 * **Nothing that decides scope, identity or a derived figure is accepted.**
 * There is no `branchId`, `fieldAgentId`, `businessDate`, `expectedCashPaise`,
 * `differencePaise` or `status` below. The branch comes from the agent's own
 * assignment, the agent from the JWT, the date from the server's Asia/Kolkata
 * clock, the expected balance from the server's own derivation over posted
 * collections, and the difference from the two counted figures.
 *
 * Accepting the expected balance would make the whole reconciliation
 * circular — the system checking the client's arithmetic against the client's
 * arithmetic — and accepting the branch is exactly what Scenarios 46 and 48
 * describe. `forbidNonWhitelisted` turns an attempt to send any of them into a
 * 400.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Integer paise. Never a number — a float would round a paisa away silently. */
const PAISE = /^\d+$/;

export class CreateCashHandoverDto {
  /**
   * What the agent is handing over.
   *
   * Must equal the sum of an oldest-first prefix of their unclaimed
   * collections. That constraint depends on server-held balances, so it is
   * enforced in the service; this layer only guarantees a positive integer.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Cash Handed Over is required' })
  @Matches(PAISE, {
    message: 'Cash Handed Over must be a whole number of paise',
  })
  @MaxLength(19, { message: 'Cash Handed Over is too large' })
  handedOverCashPaise!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  notes?: string;

  /**
   * Client-minted and required.
   *
   * Minted once per form *mount*, never per submit: a key regenerated on retry
   * defeats the mechanism, because the retry then looks like a second handover
   * and opens a second custody transfer.
   */
  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;
}

/**
 * Submit a draft for the branch to receive.
 *
 * Carries no amount. The balance check and the custody claim must run against
 * one number; letting it change here would mean one gate ran against one figure
 * and the claim against another.
 */
export class SubmitCashHandoverDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150, { message: 'Acknowledgment Reference is too long' })
  acknowledgmentReference?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Receive the cash at the branch.
 *
 * `receivedCashPaise` is what the branch physically counted, which is not
 * necessarily what the agent declared. Recording the counted figure separately
 * is what lets the difference be real and traceable rather than assumed away
 * (Scenario 24).
 *
 * The idempotency key for this act travels as an `Idempotency-Key` **header**,
 * not a field here: it identifies a retry of an operation against a row that
 * already exists, which is the header half of the codebase's two-way split.
 */
export class ReceiveCashHandoverDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Cash Received is required' })
  @Matches(PAISE, { message: 'Cash Received must be a whole number of paise' })
  @MaxLength(19, { message: 'Cash Received is too large' })
  receivedCashPaise!: string;

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
 * Reverse a received handover.
 *
 * No amount: reversal is full-only, matching Module 11's stance. A partial
 * reversal needs a per-collection unwind and a remaining-reversible concept,
 * and half of that built is worse than none.
 */
export class ReverseCashHandoverDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Reversal Reason is required' })
  @MaxLength(1000, { message: 'Reversal Reason is too long' })
  reversalReason!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class ListCashHandoversDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn([
    'CREATED',
    'SUBMITTED',
    'RECEIVED',
    'RECONCILED',
    'CANCELLED',
    'REVERSED',
  ])
  status?:
    | 'CREATED'
    | 'SUBMITTED'
    | 'RECEIVED'
    | 'RECONCILED'
    | 'CANCELLED'
    | 'REVERSED';

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
