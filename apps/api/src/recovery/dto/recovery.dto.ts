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

import { trim } from '../../common/transforms/trim';

/**
 * Module 13 — recovery DTOs.
 *
 * **These, not the zod schemas, are what guard the API.** A rule written only
 * in `@lms/validation` is enforced on the web and nowhere else; this codebase
 * has already shipped one such hole.
 *
 * **Nothing that decides scope, identity or a derived figure is accepted.**
 * No `branchId`, no `orgId`, no `customerId`, no overdue total, no penalty
 * amount, no closure figures. The branch and organization come from the JWT,
 * the customer from the loan, the overdue position from the derivation, the
 * penalty from the configured rule, and the closure snapshot is read inside the
 * closing transaction. Accepting any of them would let a form assert something
 * the server is supposed to establish.
 *
 * `forbidNonWhitelisted` turns an attempt to send one into a 400.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Integer paise. Never a number — a float would round a paisa away silently. */
const PAISE = /^\d+$/;

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const CASE_STATUSES = [
  'OPEN',
  'FIELD_ASSIGNED',
  'FIELD_VISIT',
  'BRANCH_REVIEW',
  'LEGAL_NOTICE',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'LEGAL_ACTION',
  'CLOSED',
] as const;

const ACTION_TYPES = [
  'REMINDER',
  'PHONE_CALL',
  'FIELD_ASSIGNMENT',
  'FIELD_VISIT',
  'BRANCH_REVIEW',
  'LEGAL_NOTICE',
  'SETTLEMENT',
  'LEGAL_ACTION',
] as const;

const OUTCOMES = [
  'CONTACTED_PROMISED',
  'CONTACTED_REFUSED',
  'CONTACTED_DISPUTED',
  'CONTACTED_PARTIAL_PAYMENT',
  'NO_ANSWER',
  'UNREACHABLE',
  'WRONG_CONTACT',
  'CUSTOMER_UNAVAILABLE',
  'ESCALATION_REQUIRED',
  'RESOLVED',
] as const;

const RESOLUTION_TYPES = [
  'RECOVERED_FULL',
  'RECOVERED_PARTIAL',
  'SETTLED',
  'WRITTEN_OFF',
  'RESTRUCTURED',
  'LEGAL_ACTION',
  'NOT_RECOVERABLE',
] as const;

/**
 * The GPS outcomes a *client* may claim.
 *
 * Deliberately narrower than the database enum, matching
 * `gpsCaptureStatusSchema` in `@lms/validation`: `EXPIRED` and `CANCELLED` are
 * the server's to decide, and a client that can name any outcome can name a
 * flattering one.
 */
const GPS_CAPTURE_STATUSES = ['VERIFIED', 'FAILED', 'PENDING'] as const;

/**
 * The concurrency token, as the client holds it: an ISO timestamp taken from
 * `updatedAt`. The message is what the user sees on a stale submit, so it says
 * what to do rather than naming the mechanism.
 */
const STALE_FORM = 'This form is out of date. Reload and try again.';

export class ListRecoveryCasesDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsIn(CASE_STATUSES, { message: 'Unknown recovery status' })
  status?: (typeof CASE_STATUSES)[number];

  @IsOptional()
  @IsIn(PRIORITIES, { message: 'Unknown priority' })
  priority?: (typeof PRIORITIES)[number];

  /**
   * Narrows to one officer's cases.
   *
   * Not a scope control — an officer without assignment authority is confined
   * to their own cases server-side whatever they send here. This is a filter
   * for someone who can already see the whole branch.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Select a valid recovery officer' })
  assigneeUserId?: string;

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

export class OpenRecoveryCaseDto {
  @IsUUID('4', { message: 'Select a loan' })
  loanId!: string;

  @IsOptional()
  @IsIn(PRIORITIES, { message: 'Unknown priority' })
  priority?: (typeof PRIORITIES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(2000)
  notes?: string;

  /**
   * Client-minted and required.
   *
   * Minted once per form *mount*, never per submit: a key regenerated on retry
   * defeats the mechanism, because the retry then looks like a second case and
   * two officers end up accountable for one debt.
   */
  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;
}

export class AssignRecoveryCaseDto {
  @IsUUID('4', { message: 'Select a recovery officer' })
  assigneeUserId!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: STALE_FORM })
  expectedVersion!: string;
}

export class EscalateRecoveryCaseDto {
  /**
   * Required, not optional.
   *
   * Scenario 38 requires the escalation event *and its reason* be recorded, and
   * an optional field is one nobody fills in.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Escalation reason is required' })
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: STALE_FORM })
  expectedVersion!: string;
}

export class CloseRecoveryCaseDto {
  @IsIn(RESOLUTION_TYPES, { message: 'Select how the case was resolved' })
  resolutionType!: (typeof RESOLUTION_TYPES)[number];

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Closure reason is required' })
  @MaxLength(2000)
  closureReason!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  approvalReference?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: STALE_FORM })
  expectedVersion!: string;
}

/**
 * Recording a contact, visit, follow-up or promise.
 *
 * The two cross-field rules — a promise is an amount and a date or neither, and
 * a failed GPS capture cannot cite a check-in — are enforced in the service
 * rather than here, because class-validator cannot express a conditional
 * requirement without `@ValidateIf`, which skips `@IsNotEmpty` on a required
 * field and silently accepts a missing value. The database holds both rules as
 * constraints regardless, so neither depends on a single layer remembering.
 */
export class RecordRecoveryActionDto {
  @IsIn(ACTION_TYPES, { message: 'Action Type is required' })
  actionType!: (typeof ACTION_TYPES)[number];

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Action Date is required' })
  @Matches(ISO_DATE, { message: 'Action Date must be YYYY-MM-DD' })
  actionDate!: string;

  @IsIn(OUTCOMES, { message: 'Outcome is required' })
  outcome!: (typeof OUTCOMES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(ISO_DATE, { message: 'Next Follow-up Date must be YYYY-MM-DD' })
  nextFollowUpDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(ISO_DATE, { message: 'Promise-to-Pay Date must be YYYY-MM-DD' })
  promiseToPayDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PAISE, {
    message: 'Promise-to-Pay Amount must be a whole number of paise',
  })
  @MaxLength(19, { message: 'Promise-to-Pay Amount is too large' })
  promiseToPayAmountPaise?: string;

  // --- Field evidence -----------------------------------------------------

  /** The device's stable identity for this activity, for offline replay. */
  @IsOptional()
  @IsUUID('4')
  offlineActivityUuid?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  deviceId?: string;

  @IsOptional()
  @IsIn(GPS_CAPTURE_STATUSES, { message: 'Unknown GPS capture status' })
  gpsCaptureStatus?: (typeof GPS_CAPTURE_STATUSES)[number];

  @IsOptional()
  @IsUUID('4')
  gpsCheckInId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  customerAckReference?: string;
}

/**
 * Editing a pending action (Scenario 31).
 *
 * The action type is absent deliberately: changing what an officer did is not
 * an edit, it is a different action, and Scenario 32 requires a follow-up
 * rather than a rewrite. A finalized action refuses every field, enforced by
 * the `recovery_actions_append_only` trigger.
 */
export class UpdateRecoveryActionDto {
  @IsOptional()
  @IsIn(OUTCOMES, { message: 'Unknown outcome' })
  outcome?: (typeof OUTCOMES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(ISO_DATE, { message: 'Next Follow-up Date must be YYYY-MM-DD' })
  nextFollowUpDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(ISO_DATE, { message: 'Promise-to-Pay Date must be YYYY-MM-DD' })
  promiseToPayDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PAISE, {
    message: 'Promise-to-Pay Amount must be a whole number of paise',
  })
  @MaxLength(19)
  promiseToPayAmountPaise?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: STALE_FORM })
  expectedVersion!: string;
}

/**
 * Assessing penal interest.
 *
 * **Carries no amount.** The figure comes from the configured rule and the
 * authoritative balances and dates (Rule 12, Scenario 18). Accepting one would
 * let a form decide what a borrower is charged and would make the
 * "deterministic and replayable" guarantee meaningless.
 */
export class AssessPenaltyDto {
  @IsUUID('4', { message: 'Select a loan' })
  loanId!: string;

  /** Absent means a loan-level assessment rather than one against an EMI. */
  @IsOptional()
  @IsUUID('4')
  emiId?: string;

  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;
}

export class PenaltyActionDto {
  @IsIn(['ADJUST', 'WAIVE', 'CANCEL'], { message: 'Select an action' })
  action!: 'ADJUST' | 'WAIVE' | 'CANCEL';

  /** Required for ADJUST — the amount to reduce *to*, not by. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PAISE, { message: 'Amount must be a whole number of paise' })
  @MaxLength(19)
  amountPaise?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(2000)
  reason!: string;
}

export class ProposeSettlementDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Settlement Amount is required' })
  @Matches(PAISE, {
    message: 'Settlement Amount must be a whole number of paise',
  })
  @MaxLength(19, { message: 'Settlement Amount is too large' })
  settlementAmountPaise!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Agreed Date is required' })
  @Matches(ISO_DATE, { message: 'Agreed Date must be YYYY-MM-DD' })
  agreedDate!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(2000)
  reason!: string;

  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;
}

export class DecideSettlementDto {
  @IsIn(['APPROVE', 'REJECT'], { message: 'Select a decision' })
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  approvalReference?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(2000)
  reason?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: STALE_FORM })
  expectedVersion!: string;
}

export class IssueLegalNoticeDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Notice Date is required' })
  @Matches(ISO_DATE, { message: 'Notice Date must be YYYY-MM-DD' })
  noticeDate!: string;

  @Type(() => Number)
  @IsInt({ message: 'Notice period must be a whole number of days' })
  @Min(1, { message: 'Notice period must be at least one day' })
  @Max(365, { message: 'Notice period must be 365 days or fewer' })
  noticePeriodDays!: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  noticeReference?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  documentRef?: string;
}

/**
 * Writing off an unrecoverable loan.
 *
 * The most irreversible act in the module. Carries no amount for the same
 * reason the penalty assessment does not: what is written off is what is
 * outstanding, read inside the posting transaction.
 */
export class WriteOffLoanDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'A write-off reason is required' })
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  approvalReference?: string;

  @IsUUID('4', { message: 'Idempotency Key is required' })
  idempotencyKey!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: STALE_FORM })
  expectedVersion!: string;
}
