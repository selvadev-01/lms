import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListMaintenanceJobsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(60)
  jobType?: string;

  @IsOptional()
  @IsIn([
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'RETRY_SCHEDULED',
    'CANCELLED',
    'RECOVERY_REQUIRED',
  ])
  status?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Enter the business date as YYYY-MM-DD' })
  businessDate?: string;
}

/**
 * Start an end-of-day run.
 *
 * `triggerType` is deliberately absent: a request arriving over HTTP is a MANUAL
 * run by definition, and letting a caller claim SCHEDULED would corrupt the
 * distinction Rule 63 requires between scheduled and manual work in operational
 * history.
 */
export class StartEodDto {
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Enter the business date as YYYY-MM-DD' })
  businessDate?: string;
}

export class SetMaintenanceModeDto {
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @IsNotEmpty({ message: 'Reason is required' })
  @Transform(trim)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  expectedEndAt?: string | null;

  /**
   * Permission codes that may keep operating while maintenance is on.
   *
   * An exemption for callers who are ALREADY authorized, never a grant — the
   * guard runs after `PermissionsGuard`, so a code listed here cannot give
   * anybody a permission they do not hold (Rule 78).
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedPermissions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedOperations?: string[];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  userMessage?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
