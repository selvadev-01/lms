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
import {
  PostCollectionDto,
  SyncCollectionDto,
} from '../../../loans/collection/dto/collection.dto';

/**
 * Module 12 — field collection DTOs.
 *
 * **These, not the zod schemas, are what guard the API.** The schemas in
 * `packages/validation` run in the browser; a rule written only there is
 * enforced only there.
 *
 * Extends the Module 11 DTOs rather than restating them, for the same reason
 * the service delegates to `postField`: a field collection *is* a collection,
 * and a second copy of the amount, loan and idempotency rules is how the two
 * come to disagree about what a valid payment looks like.
 *
 * **Nothing that decides scope, identity or custody is accepted.** No
 * `branchId`, `collectorUserId`, `receiptNumber`, `isFieldCollection` or
 * `custodyHandoverId` appears below. Branch and customer come from the loan,
 * the agent from the JWT, the receipt from the server's sequence, and the
 * custody link is set only by a handover claiming the row.
 * `forbidNonWhitelisted` turns an attempt to send any of them into a 400, which
 * is what makes Scenario 48 structural rather than a check.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the device reports about its GPS capture.
 *
 * A deliberate subset of `GpsVerificationStatus`. `EXPIRED` and `CANCELLED` are
 * server verdicts, and a client that can name any outcome can name a
 * flattering one — the same restriction `ReportFailureDto` applies to failure
 * reasons.
 *
 * `VERIFIED` is a *claim*, not a fact. The service resolves the named check-in
 * and refuses the claim if it does not exist, belongs to another user, or was
 * not itself verified (Rule 41, Scenario 55).
 */
const GPS_CAPTURE_STATUSES = ['VERIFIED', 'FAILED', 'PENDING'] as const;

/**
 * The evidence fields, declared once and mixed into both bodies.
 *
 * A base class rather than duplication: the online and offline bodies differ
 * only in whether they carry the device's transaction id and capture time, and
 * two copies of the GPS contract would be two things to keep in step.
 */
class FieldEvidenceDto extends PostCollectionDto {
  @IsIn(GPS_CAPTURE_STATUSES, { message: 'GPS Capture Status is required' })
  gpsCaptureStatus!: 'VERIFIED' | 'FAILED' | 'PENDING';

  /**
   * The check-in that verified this location.
   *
   * Optional here because a *failed* capture has none — that is the whole
   * reason the status is a separate field. Required in practice for a
   * `VERIFIED` claim, enforced in the service against the resolved row rather
   * than by `@ValidateIf`, which would skip the presence check entirely when
   * the condition is false.
   */
  @IsOptional()
  @IsUUID('4', { message: 'GPS evidence must reference a check-in' })
  gpsCheckInId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Visit reference must be a visit id' })
  fieldVisitId?: string;

  /**
   * Whatever the customer signed, stamped or acknowledged.
   *
   * Free text because the form differs by branch — a signature book page, an
   * SMS confirmation id, a photo filename — and modelling one would exclude
   * the others.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150, { message: 'Acknowledgment Reference is too long' })
  customerAckReference?: string;

  /**
   * The device that took the payment.
   *
   * Required even online, unlike Module 11's sync-only field. The device is
   * what holds the cash trail together when the agent later goes offline, and
   * an agent whose device id appears only sometimes is an agent whose
   * collections cannot be grouped by device at all.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Device id is required' })
  @MaxLength(150, { message: 'Device id is too long' })
  deviceId!: string;
}

/** Record a collection taken in the field, online. */
export class RecordFieldCollectionDto extends FieldEvidenceDto {}

/**
 * Sync a collection captured offline.
 *
 * The offline identity comes from the Module 11 contract unchanged.
 * `collectedAt` is retained as evidence and is never authoritative: the
 * business date is the server's Asia/Kolkata clock (Rules 14, 15).
 */
export class SyncFieldCollectionDto extends FieldEvidenceDto {
  @IsUUID('4', { message: 'A stable offline transaction id is required' })
  offlineTransactionUuid!: string;

  @IsISO8601({ strict: true }, { message: 'Captured time must be a timestamp' })
  collectedAt!: string;
}

/**
 * Confirm or reject a collection captured offline.
 *
 * Carries `expectedVersion` because — unlike posting, which creates and commits
 * in one act — this acts on a row that exists and that another reviewer may
 * have decided in the meantime.
 *
 * A rejection must give a reason; a confirmation need not. Demanding a sentence
 * for "it is what it says it is" trains reviewers to type "ok". The conditional
 * is enforced in the service, never by `@ValidateIf`.
 */
export class VerifyCollectionDto {
  @IsIn(['CONFIRMED', 'REJECTED'], {
    message: 'Verification Decision is required',
  })
  decision!: 'CONFIRMED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000, { message: 'Reason is too long' })
  verificationNotes?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * The field collection list filter.
 *
 * No `branchId` and no `fieldAgentId`. Branch scope comes from the session, and
 * an agent's own confinement is applied server-side from their permissions —
 * accepting either here would mean the server had to decide whether to believe
 * it (Scenarios 1, 2, 48).
 */
export class ListFieldCollectionsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['CREATED', 'SYNCED', 'POSTED', 'REVERSED', 'FAILED'])
  status?: 'CREATED' | 'SYNCED' | 'POSTED' | 'REVERSED' | 'FAILED';

  @IsOptional()
  @IsIn(['CASH', 'UPI', 'BANK_TRANSFER'])
  paymentMode?: 'CASH' | 'UPI' | 'BANK_TRANSFER';

  @IsOptional()
  @IsIn(GPS_CAPTURE_STATUSES)
  gpsCaptureStatus?: 'VERIFIED' | 'FAILED' | 'PENDING';

  @IsOptional()
  @IsUUID('4')
  loanId?: string;

  /**
   * Narrow to cash still in the agent's custody — the handover work list.
   *
   * `'true'` rather than a boolean transform: a query string carries text, and
   * a `@Type(() => Boolean)` would turn `'false'` into `true` because every
   * non-empty string is truthy.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  awaitingHandover?: 'true' | 'false';

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

/** Re-exported so the controller imports one module for its bodies. */
export { SyncCollectionDto };
