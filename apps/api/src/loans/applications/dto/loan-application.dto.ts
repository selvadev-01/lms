import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
 * Module 07 — loan application DTOs.
 *
 * Three conventions run through all of them:
 *
 * 1. **No scope fields.** No `orgId`, no `branchId`, and no `status`. The first
 *    two come from the JWT and from the selected customer's own branch, which is
 *    what makes Scenarios 41-43 structural rather than a check somebody has to
 *    remember; `forbidNonWhitelisted` turns an attempt to send one into a 400.
 *    Status moves only through the lifecycle endpoints.
 *
 * 2. **Money is a paise string, rates are basis-point strings.** Never numbers.
 *    A loan amount large enough to matter exceeds `Number.MAX_SAFE_INTEGER` in
 *    paise, and a JSON number is a float. The service parses with `BigInt`.
 *
 * 3. **Decorator order is deliberate.** `@IsNotEmpty` precedes `@Matches` and
 *    `@MaxLength`, so a blank submission reports "X is required" rather than a
 *    pattern complaint about the empty string. Note that `@ValidateIf` is
 *    avoided on required fields entirely: it skips `@IsNotEmpty` and would
 *    silently accept a missing value.
 */

/**
 * Wizard steps 1-3, submitted together.
 *
 * There is deliberately no "create an empty draft" DTO. `LoanApplication` has
 * nine non-null columns, so a row cannot exist until customer, amount and terms
 * are all chosen. Making them nullable for the draft's sake would force every
 * later reader — approval, sanction, disbursal, schedule generation — to
 * null-check columns that are populated for every row that ever reaches them,
 * and the database would stop expressing "a submitted application has terms"
 * (D-APP-1).
 *
 * `loanProductId` is absent because the scheme determines it: a scheme belongs
 * to exactly one product, so accepting both would allow a mismatched pair.
 */
export class CreateLoanApplicationDto {
  @IsUUID('4', { message: 'Select a customer' })
  customerId!: string;

  @IsUUID('4', { message: 'Select a loan scheme' })
  loanSchemeId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Loan Amount is required' })
  @Matches(/^\d+$/, { message: 'Loan Amount must be a whole number of paise' })
  @MaxLength(19, { message: 'Loan Amount is too large' })
  requestedAmountPaise!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Purpose is required' })
  @MaxLength(500)
  purpose!: string;

  @IsIn(['FLAT', 'REDUCING', 'CUSTOM_RATE'], {
    message: 'Interest Type is required',
  })
  interestType!: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Interest Rate is required' })
  @Matches(/^\d+$/, {
    message: 'Interest Rate must be a whole number of basis points',
  })
  @MaxLength(10)
  interestRateBps!: string;

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], {
    message: 'Frequency is required',
  })
  repaymentFrequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of periods' })
  @Min(1, { message: 'Duration must be at least one period' })
  @Max(10_000, { message: 'Duration is too long' })
  durationCount!: number;
}

/**
 * Draft edits.
 *
 * `customerId` is absent: changing who an application is for turns it into a
 * different application, and would strand any documents already uploaded against
 * the original borrower.
 */
export class UpdateLoanApplicationDto {
  @IsUUID('4', { message: 'Select a loan scheme' })
  loanSchemeId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Loan Amount is required' })
  @Matches(/^\d+$/, { message: 'Loan Amount must be a whole number of paise' })
  @MaxLength(19, { message: 'Loan Amount is too large' })
  requestedAmountPaise!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Purpose is required' })
  @MaxLength(500)
  purpose!: string;

  @IsIn(['FLAT', 'REDUCING', 'CUSTOM_RATE'], {
    message: 'Interest Type is required',
  })
  interestType!: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Interest Rate is required' })
  @Matches(/^\d+$/, {
    message: 'Interest Rate must be a whole number of basis points',
  })
  @MaxLength(10)
  interestRateBps!: string;

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], {
    message: 'Frequency is required',
  })
  repaymentFrequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of periods' })
  @Min(1, { message: 'Duration must be at least one period' })
  @Max(10_000, { message: 'Duration is too long' })
  durationCount!: number;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/** Stateless EMI preview for wizard step 4. Touches no stored record. */
export class EmiPreviewDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Loan Amount is required' })
  @Matches(/^\d+$/, { message: 'Loan Amount must be a whole number of paise' })
  @MaxLength(19, { message: 'Loan Amount is too large' })
  principalPaise!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Interest Rate is required' })
  @Matches(/^\d+$/, {
    message: 'Interest Rate must be a whole number of basis points',
  })
  @MaxLength(10)
  annualRateBps!: string;

  @IsIn(['FLAT', 'REDUCING', 'CUSTOM_RATE'], {
    message: 'Interest Type is required',
  })
  interestType!: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], {
    message: 'Frequency is required',
  })
  frequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of periods' })
  @Min(1, { message: 'Duration must be at least one period' })
  @Max(10_000, { message: 'Duration is too long' })
  durationCount!: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Start date must be YYYY-MM-DD' })
  startDate?: string;
}

/**
 * Every lifecycle transition carries the version it believes it is acting on.
 *
 * Unlike a draft edit, where a stale version is checked and then written, a
 * transition puts this value *and* the expected status into the `updateMany`
 * WHERE clause. A read-then-write check cannot stop two concurrent approve and
 * reject requests both passing it (Scenario 52).
 */
export class ApplicationTransitionDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class RequestMoreInfoDto {
  /**
   * Required, unlike most comment fields: "provide more information" without
   * saying which information is a round trip that helps nobody (Scenario 22).
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Describe what is needed' })
  @MaxLength(1000)
  comments!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/** Adjust rate or duration during review (Scenario 16). */
export class ModifyTermsDto {
  @IsIn(['FLAT', 'REDUCING', 'CUSTOM_RATE'], {
    message: 'Interest Type is required',
  })
  interestType!: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Interest Rate is required' })
  @Matches(/^\d+$/, {
    message: 'Interest Rate must be a whole number of basis points',
  })
  @MaxLength(10)
  interestRateBps!: string;

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], {
    message: 'Frequency is required',
  })
  repaymentFrequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of periods' })
  @Min(1, { message: 'Duration must be at least one period' })
  @Max(10_000, { message: 'Duration is too long' })
  durationCount!: number;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Record why the terms changed' })
  @MaxLength(1000)
  comments!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class ApproveApplicationDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  comments?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Approve and issue the sanction letter in one request.
 *
 * The union of `ApproveApplicationDto` and `IssueSanctionDto`, minus the second
 * `expectedVersion` — the approval bumps the row, so the sanction is issued
 * against the version approval produced rather than one the caller could supply.
 * Every field but the version is optional, which is the point: this combines two
 * steps that between them ask for nothing mandatory.
 */
export class ApproveAndIssueDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  comments?: string;

  /** Recorded on the letter, not enforced — see `IssueSanctionDto`. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Valid Until must be a date in YYYY-MM-DD format',
  })
  validUntil?: string;

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

export class RejectApplicationDto {
  /**
   * Mandatory, and separate from `comments` (Rule 40, Scenario 27). The unified
   * REJECTED status carries no information on its own; the reason is the record.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Rejection Reason is required' })
  @MaxLength(1000)
  rejectionReason!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  comments?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

// --- Module 08: Approval Workflow -------------------------------------------

/**
 * Record a credit assessment (Scenarios 7, 9).
 *
 * No `expectedVersion`: recording an assessment is not a lifecycle transition
 * and does not read-modify-write the application row.
 *
 * `assessmentResult` is required and has no default. A default of PASS would be
 * Scenario 9 implemented backwards in a single line; a default of anything else
 * would be a finding nobody actually made.
 */
export class RecordCreditAssessmentDto {
  @IsOptional()
  @IsInt({ message: 'CIBIL Score must be a whole number' })
  @Min(300, { message: 'CIBIL Score must be between 300 and 900' })
  @Max(900, { message: 'CIBIL Score must be between 300 and 900' })
  @Type(() => Number)
  cibilScore?: number;

  /**
   * Required for the same reason `assessmentResult` is: the column is nullable
   * to express "not checked", but a reviewer submitting this form has checked.
   *
   * Transformed by hand rather than with `@Type(() => Boolean)`, which would
   * apply `Boolean("false")` and yield `true` — turning every failed income
   * check into a passed one.
   */
  @Transform(({ value }): unknown => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    // Anything else is passed through unchanged so `@IsBoolean` reports it,
    // rather than being coerced into a finding nobody made.
    return value;
  })
  @IsBoolean({ message: 'Income Check is required' })
  incomeVerified!: boolean;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d+$/, {
    message: 'Monthly Income must be a whole number of paise',
  })
  @MaxLength(19)
  incomeMonthlyPaise?: string;

  @IsIn(['PASS', 'FAIL', 'MANUAL_REVIEW'], {
    message: 'Assessment Result is required',
  })
  assessmentResult!: 'PASS' | 'FAIL' | 'MANUAL_REVIEW';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(2000)
  assessmentNotes?: string;
}

/** Issue the sanction letter. Terms come from the application, not from here. */
export class IssueSanctionDto {
  /**
   * Recorded, not enforced. DATE-only in the same shape the list filters use,
   * never a datetime: a sanction expires on a day, not at an instant.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Valid Until must be a date in YYYY-MM-DD format',
  })
  validUntil?: string;

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

/** The customer accepted the sanction letter (Scenario 33). */
export class AcceptSanctionDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  comments?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * The customer declined the sanction letter (Scenario 32).
 *
 * The reason is mandatory for exactly the reason `RejectApplicationDto`'s is:
 * the decline lands on the unified REJECTED status, which carries no
 * information on its own.
 */
export class DeclineSanctionDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Decline Reason is required' })
  @MaxLength(1000)
  declineReason!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  comments?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Record that the signed loan agreement was received (Rules 11, 12).
 *
 * `signedDate` is optional and defaults to now, because a physically signed
 * agreement often reaches the branch days after it was signed.
 */
export class RecordAgreementDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Signed Date must be a date in YYYY-MM-DD format',
  })
  signedDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  agreementReference?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  comments?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/** List filters. Absent means "no filter", never "match nothing". */
export class ListLoanApplicationsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  search?: string;

  /**
   * The nine reachable statuses. `CUSTOMER_REJECTED` is deliberately absent —
   * a customer's decline lands on the unified REJECTED (Rule 13) — as are the
   * three disbursal states, which are Module 09's.
   */
  @IsOptional()
  @IsIn([
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'MORE_INFO_REQUIRED',
    'REJECTED',
    'APPROVED',
    'SANCTIONED',
    'CUSTOMER_ACCEPTED',
    'AGREEMENT_SIGNED',
  ])
  status?:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'UNDER_REVIEW'
    | 'MORE_INFO_REQUIRED'
    | 'REJECTED'
    | 'APPROVED'
    | 'SANCTIONED'
    | 'CUSTOMER_ACCEPTED'
    | 'AGREEMENT_SIGNED';

  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From date must be YYYY-MM-DD' })
  fromDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To date must be YYYY-MM-DD' })
  toDate?: string;
}

/**
 * The three categories the source names for application support (Rule 34).
 *
 * Deliberately a different set from the borrower's KYC types: application
 * documents live in their own table under their own permissions, and one shared
 * enum is how a reviewer's reach would widen by accident.
 */
export class UploadApplicationDocumentDto {
  @IsIn(['ID', 'INCOME', 'COLLATERAL'], {
    message: 'Document Type is required',
  })
  documentType!: 'ID' | 'INCOME' | 'COLLATERAL';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  documentNumber?: string;
}

/**
 * Attach a document the same customer already filed on an earlier application.
 *
 * Only the source id: the type, file and number all come from the row being
 * reused, so there is nothing for a caller to disagree with it about. That the
 * source belongs to *this* customer is checked in the service, which is the only
 * layer that can see both applications.
 */
export class ReuseApplicationDocumentDto {
  @IsUUID('4', { message: 'Select a document to reuse' })
  sourceDocumentId!: string;
}

export class VerifyApplicationDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'], { message: 'Decision is required' })
  status!: 'VERIFIED' | 'REJECTED';

  /**
   * Required when rejecting, checked in the service rather than here.
   *
   * `@ValidateIf` would be the obvious tool and is the wrong one: on a field
   * that is otherwise optional it silently skips `@IsNotEmpty`, so a missing
   * value would pass. The service raises the 400 instead.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;
}
