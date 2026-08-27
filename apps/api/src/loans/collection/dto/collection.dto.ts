import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
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
 * Module 11 — EMI collection DTOs.
 *
 * **These, not the zod schemas, are what guard the API.** The schemas in
 * `packages/validation` run in the browser; a rule written only there is
 * enforced only there. The two are deliberately kept in step.
 *
 * Follows `disbursement.dto.ts` in all of its conventions, and two matter
 * especially here:
 *
 * **`@ValidateIf` is never used on a required field.** It skips `@IsNotEmpty`
 * and silently accepts a missing value. The one rule that tempts it — "a
 * payment reference is required for UPI and bank transfer" (Scenario 45) — is
 * therefore enforced in the service against the resolved payment mode, and in
 * the shared zod schema at the object level, never by a conditional decorator.
 *
 * **Nothing that decides scope, identity or money is accepted.** There is no
 * `branchId`, `customerId`, `collectorUserId`, `receiptNumber`, `status` or
 * allocation field anywhere below. Branch and customer come from the loan, the
 * collector from the JWT, the receipt from the server's sequence, and the
 * allocation from the server's own recomputation against authoritative
 * balances. `forbidNonWhitelisted` turns an attempt to send any of them into a
 * 400, which is what makes Scenarios 37, 38 and 39 structural.
 */

/** `YYYY-MM-DD`. Existence is checked in the service, not by the pattern. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Integer paise. Never a number — a float would round a paisa away silently. */
const PAISE = /^\d+$/;

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

export class PostCollectionDto {
  @IsUUID('4', { message: 'Loan is required' })
  loanId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Collection Date is required' })
  @Matches(ISO_DATE, { message: 'Collection Date must be a valid date' })
  collectionDate!: string;

  @IsIn(['CASH', 'UPI', 'BANK_TRANSFER'], {
    message: 'Payment Mode is required',
  })
  paymentMode!: 'CASH' | 'UPI' | 'BANK_TRANSFER';

  /**
   * What the borrower actually tendered.
   *
   * Unlike disbursal's amount — which exists only to be compared against the
   * sanction — this one *is* the money. It is still never trusted as an
   * allocation: the server splits it against balances it read itself.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Collected Amount is required' })
  @Matches(PAISE, {
    message: 'Collected Amount must be a whole number of paise',
  })
  @MaxLength(19, { message: 'Collected Amount is too large' })
  amountPaise!: string;

  /**
   * Optional at this layer because cash has no external system to reference.
   * Whether it is required is a function of `paymentMode`, which the service
   * decides — see the class comment on why not `@ValidateIf`.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(REFERENCE, {
    message:
      'Payment Reference may use letters, digits, hyphen, underscore and slash only',
  })
  @MaxLength(150, { message: 'Payment Reference is too long' })
  transactionReference?: string;

  /**
   * Client-minted and required (Rule 7).
   *
   * It must be minted once per form *mount*, not per submit. A key regenerated
   * on retry defeats the mechanism entirely, because the retry then looks like
   * a different payment and posts a second time.
   */
  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  notes?: string;
}

/**
 * Submit a collection captured offline.
 *
 * Every field of the online body, plus the device's identity. Module 11 owns
 * this contract; the device-side queue that produces it is Module 12's.
 */
export class SyncCollectionDto extends PostCollectionDto {
  /**
   * The device's stable id for this transaction (Scenario 17).
   *
   * Unique at organization scope, so a retried sync of an already-posted
   * capture replays rather than posting twice (Scenario 42).
   */
  @IsUUID('4', { message: 'A stable offline transaction id is required' })
  offlineTransactionUuid!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Device id is required' })
  @MaxLength(150, { message: 'Device id is too long' })
  deviceId!: string;

  /**
   * When the device says it took the money.
   *
   * Retained as evidence and never authoritative: the business date comes from
   * the server's Asia/Kolkata clock (Rules 34, 35). A device with a wrong clock
   * changes what the receipt records, not what the ledger posts.
   */
  @IsISO8601({ strict: true }, { message: 'Captured time must be a timestamp' })
  collectedAt!: string;
}

export class PreviewAllocationDto {
  @IsUUID('4', { message: 'Loan is required' })
  loanId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Collected Amount is required' })
  @Matches(PAISE, {
    message: 'Collected Amount must be a whole number of paise',
  })
  @MaxLength(19, { message: 'Collected Amount is too large' })
  amountPaise!: string;
}

/**
 * Reverse a posted collection.
 *
 * No amount: reversal is full-only. A partial reversal needs per-component
 * unwind arithmetic and a remaining-reversible concept, and half of that built
 * is worse than none.
 */
export class ReverseCollectionDto {
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

/**
 * The collection list filter.
 *
 * No `branchId`: scope comes from the session. Accepting one would mean the
 * server had to decide whether to believe it (Scenario 1).
 */
export class ListCollectionsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['CREATED', 'SYNCED', 'POSTED', 'REVERSED', 'FAILED'])
  status?: 'CREATED' | 'SYNCED' | 'POSTED' | 'REVERSED' | 'FAILED';

  @IsOptional()
  @IsUUID('4')
  loanId?: string;

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
