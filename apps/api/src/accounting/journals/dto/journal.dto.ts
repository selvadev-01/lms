import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Journal request shapes.
 *
 * **These, not the zod schemas, are what guard the API.** The schemas in
 * `packages/validation` run in the browser; a rule written only there is
 * enforced only there. Beneath both, the database triggers are what actually
 * guarantee the invariants — `journal_lines_shape` for the per-line rules and
 * `assert_entry_postable` for the set-level ones.
 *
 * # What is absent, and why
 *
 * - **`orgId` / `branchId`** — scope comes from the JWT. A client-supplied
 *   branch is what Scenario 53 forbids, and its absence plus the global
 *   `forbidNonWhitelisted` is what makes that structural rather than a check.
 * - **`entryNumber`** — allocated from the organization's sequence at creation.
 * - **`status`, `postedAt`, `postedBy`** — the lifecycle is the server's.
 * - **`sourceType` / `sourceId`** — a manual journal has no source
 *   transaction, and letting a client claim one would let a hand-written entry
 *   masquerade as a disbursal in reconciliation.
 *
 * # Why the cross-line rules are not here
 *
 * Balance, at-least-one-of-each-side and duplicate-account checks need the
 * whole set, and class-validator's per-property model expresses them poorly.
 * They live in `JournalService`, which produces the message, and in
 * `assert_entry_postable`, which is the guarantee.
 */

const MANUAL_ENTRY_TYPES = ['MANUAL', 'ADJUSTMENT'] as const;

const JOURNAL_STATUSES = ['DRAFT', 'POSTED', 'REVERSED'] as const;

/**
 * Every `JournalEntryType`, for the list filter only.
 *
 * Wider than `MANUAL_ENTRY_TYPES` on purpose: a person may only *author* the
 * two, but the journal list has to be filterable by the thirteen a source
 * module writes — a finance user looking for yesterday's disbursals is the
 * ordinary case. Constrained to the enum rather than left a free string so a
 * typo is a 400 rather than a filter that silently matches nothing.
 */
const FILTERABLE_ENTRY_TYPES = [
  'DISBURSEMENT',
  'COLLECTION',
  'INTEREST_ACCRUAL',
  'PENALTY_ASSESSMENT',
  'PENALTY_ADJUSTMENT',
  'PENALTY_WAIVER',
  'PENALTY_CANCELLATION',
  'FEE',
  'EXPENSE',
  'SETTLEMENT',
  'WRITE_OFF',
  'LOAN_CLOSURE',
  'REVERSAL',
  'MANUAL',
  'ADJUSTMENT',
] as const;

/**
 * One line of a journal.
 *
 * Both amounts are digit strings rather than numbers, for the reason
 * `paiseString` documents: a rupee figure large enough to matter exceeds
 * `Number.MAX_SAFE_INTEGER` in paise, and a coerced number would round it
 * silently instead of failing. `"100.50"` is rejected outright rather than
 * interpreted — rupees typed into a paise field and paise typed correctly are
 * indistinguishable, and guessing is how an entry posts at a hundredth of its
 * intended size.
 */
export class JournalLineDto {
  @IsUUID('4', { message: 'Account is required' })
  accountId!: string;

  @IsString({ message: 'Debit must be a whole number of paise' })
  @Matches(/^\d+$/, { message: 'Debit must be a whole number of paise' })
  @MaxLength(19, { message: 'Debit is too large' })
  debitPaise!: string;

  @IsString({ message: 'Credit must be a whole number of paise' })
  @Matches(/^\d+$/, { message: 'Credit must be a whole number of paise' })
  @MaxLength(19, { message: 'Credit is too large' })
  creditPaise!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  description?: string;
}

/**
 * The fields a journal carries whether it is being created or edited.
 *
 * `CreateJournalDto` and `UpdateJournalDto` both extend this rather than one
 * extending the other: create needs an idempotency key and edit needs a
 * version, and neither should inherit the other's.
 */
class JournalBodyDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Business Date is required' })
  entryDate!: string;

  @IsIn([...MANUAL_ENTRY_TYPES], { message: 'Journal Type is required' })
  entryType!: (typeof MANUAL_ENTRY_TYPES)[number];

  @IsString({ message: 'Description is required' })
  @IsNotEmpty({ message: 'Description is required' })
  @Transform(trim)
  @MaxLength(1000, { message: 'Description is too long' })
  description!: string;

  /**
   * At least two lines, because a journal needs a debit and a credit and one
   * line cannot be both. The upper bound is a guard against a runaway client
   * rather than a business limit.
   */
  @IsArray({ message: 'At least one journal line is required' })
  @ArrayMinSize(2, {
    message: 'A journal needs at least one debit line and one credit line',
  })
  @ArrayMaxSize(200, { message: 'A journal may have at most 200 lines' })
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];

  /**
   * Required when `entryType` is ADJUSTMENT — enforced in the service rather
   * than with `@ValidateIf`, which on a required field skips `@IsNotEmpty` and
   * silently accepts a missing value.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  adjustmentReason?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  approvalReference?: string;
}

export class CreateJournalDto extends JournalBodyDto {
  /**
   * Minted once per form by the client.
   *
   * A double submit returns the draft that already exists rather than creating
   * a second one. Not an `expectedVersion`: there is no prior row for the
   * request to be stale against.
   */
  @IsUUID('4', { message: 'Idempotency key must be a UUID' })
  idempotencyKey!: string;
}

/**
 * Edit a draft.
 *
 * Lines are replaced wholesale rather than patched. A journal is meaningful
 * only as a balanced set, so a partial line update would have to be validated
 * against rows the request did not send.
 */
export class UpdateJournalDto extends JournalBodyDto {
  @IsString({ message: 'This form is out of date. Reload and try again.' })
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Check a draft without saving it.
 *
 * Accepts — and ignores — an `idempotencyKey`, unlike every other read-shaped
 * DTO in the codebase. The reason is ergonomic rather than semantic: the journal
 * builder mints its key once per form and validates the same body it will later
 * submit, so refusing the key here would force the client to strip a field
 * before every keystroke-driven check, and `forbidNonWhitelisted` would make
 * forgetting that a 400 in the middle of typing.
 *
 * Nothing is written, so the key has nothing to deduplicate; it is declared
 * only so that it is not rejected.
 */
export class ValidateJournalDto extends JournalBodyDto {
  @IsOptional()
  @IsUUID('4', { message: 'Idempotency key must be a UUID' })
  idempotencyKey?: string;
}

export class PostJournalDto {
  @IsString({ message: 'This form is out of date. Reload and try again.' })
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Reverse a posted journal.
 *
 * The reason is required, unlike most reason fields in the app: a reversal
 * unwinds a committed financial posting, and the audit trail has to answer
 * "why" without a second query.
 */
export class ReverseJournalDto {
  @IsString({ message: 'Reversal Reason is required' })
  @IsNotEmpty({ message: 'Reversal Reason is required' })
  @Transform(trim)
  @MaxLength(1000, { message: 'Reversal Reason is too long' })
  reversalReason!: string;

  /**
   * Defaults server-side to today's Asia/Kolkata business date. When supplied
   * it may not precede the original's date — reversing into a period that has
   * already been reported would rewrite a published figure.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Business Date must be a valid date',
  })
  entryDate?: string;

  @IsString({ message: 'This form is out of date. Reload and try again.' })
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class ListJournalsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn([...JOURNAL_STATUSES])
  status?: (typeof JOURNAL_STATUSES)[number];

  @IsOptional()
  @IsIn([...FILTERABLE_ENTRY_TYPES])
  entryType?: (typeof FILTERABLE_ENTRY_TYPES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(50)
  sourceType?: string;

  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date must be a valid date' })
  fromDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To Date must be a valid date' })
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
