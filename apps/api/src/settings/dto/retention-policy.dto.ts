import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Retention policy DTOs (Scenarios 55-58).
 *
 * As elsewhere in this module, these duplicate the zod schemas deliberately: a
 * rule written only in `@lms/validation` is enforced on the web only, and the
 * API would accept whatever a direct caller sent.
 *
 * `immutableEvidence` is absent from every DTO here on purpose. It is derived
 * from the record category by the service and stored — accepting it from the
 * client would let a caller mark ledger evidence purgeable, which is exactly
 * what Rule 76 forbids.
 */

/** Mirrors the `RetentionRecordCategory` enum; a closed list, never free text. */
export const RETENTION_RECORD_CATEGORIES = [
  'AUDIT_LOG',
  'LEDGER_ENTRY',
  'JOURNAL_ENTRY',
  'NOTIFICATION_LOG',
  'MAINTENANCE_JOB',
  'USER_SESSION',
  'REPORT_RUN',
] as const;

export const RETENTION_POLICY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/**
 * Ten years. Long enough for the statutory retention this system is likely to
 * face, and short enough that a mistyped value is refused rather than stored as
 * an effectively infinite retention nobody notices.
 */
const MAX_RETENTION_DAYS = 3650;

export class CreateRetentionPolicyDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Policy Name is required' })
  @MaxLength(200)
  name!: string;

  @IsIn([...RETENTION_RECORD_CATEGORIES], {
    message: 'Choose a supported record category',
  })
  recordCategory!: string;

  @IsInt({ message: 'Retention Period must be a whole number of days' })
  @Min(1, { message: 'Retention Period must be at least one day' })
  @Max(MAX_RETENTION_DAYS)
  retentionPeriodDays!: number;

  // Null is meaningful and distinct from absent: "never archive" rather than
  // "unchanged". Both DTOs accept it for that reason.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RETENTION_DAYS)
  archiveAfterDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RETENTION_DAYS)
  purgeAfterDays?: number | null;

  @IsOptional()
  @IsBoolean()
  legalHoldSupported?: boolean;
}

/**
 * Every field optional except the version.
 *
 * `recordCategory` is absent: it is what the policy is keyed on for the partial
 * unique index, and editing it would silently move the policy to a category
 * that may already have an active one. Retire the policy and create another.
 */
export class UpdateRetentionPolicyDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Policy Name cannot be blank' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RETENTION_DAYS)
  retentionPeriodDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RETENTION_DAYS)
  archiveAfterDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RETENTION_DAYS)
  purgeAfterDays?: number | null;

  @IsOptional()
  @IsBoolean()
  legalHoldSupported?: boolean;

  @IsOptional()
  @IsIn([...RETENTION_POLICY_STATUSES])
  status?: string;

  /** Optimistic lock. Required: an update with no expected version cannot
   * detect the concurrent change it would otherwise overwrite. */
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ListRetentionPoliciesDto {
  @IsOptional()
  @IsIn([...RETENTION_RECORD_CATEGORIES])
  recordCategory?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
