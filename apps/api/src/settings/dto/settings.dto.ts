import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsArray,
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
import { SETTING_CATEGORIES } from '@lms/validation';

import { trim } from '../../common/transforms/trim';

/**
 * Module 17 DTOs.
 *
 * These mirror the zod schemas in `@lms/validation` field for field, and that
 * duplication is deliberate rather than redundant: the zod schemas run in the
 * browser and guard nothing against a direct API caller. A rule written only
 * there is enforced on the web only.
 *
 * The global `ValidationPipe` runs with `whitelist` AND `forbidNonWhitelisted`,
 * so a property carrying no validation decorator is stripped and then rejected.
 * That has two consequences worth stating together, because the first is the
 * design and the second is a trap:
 *
 *  * a field absent from a DTO is a 400 rather than a silently ignored value,
 *    which is how the unsettable fields below are made unsettable — by absence
 *    rather than by a check somebody has to remember;
 *  * a field that is PRESENT but undecorated is treated identically. A
 *    pass-through value therefore needs `@Allow()`, or the pipe discards exactly
 *    the property it was meant to carry. See `UpsertSettingDto.value`.
 *
 * The unsettable fields:
 *
 *  * no `requiresApproval` or `isProtected` anywhere — both come from the
 *    registry, and a submitter who could send them could switch off
 *    maker-checker (Rule 43);
 *  * no `orgId` anywhere — scope comes from the authenticated session;
 *  * no `version` on create, no `settingCode` on update.
 */

/** An ISO date, DATE-only, Asia/Kolkata semantics (Rules 16, 17). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A local wall-clock time. Not a timestamp — see `BusinessCalendar`. */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpsertSettingDto {
  @IsString()
  @IsNotEmpty({ message: 'Setting Code is required' })
  @Transform(trim)
  @MaxLength(100)
  settingCode!: string;

  /** Null means organization-wide; omitted means "the caller's own scope". */
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  /**
   * Untyped on purpose: the registry's zod schema decides what is legal for this
   * code. Typing it here would mean maintaining the same union twice, and the
   * looser of the two would win.
   *
   * `@Allow()` is required and is NOT decoration. The global `ValidationPipe`
   * runs with `whitelist`, which STRIPS every property carrying no validation
   * decorator — and `forbidNonWhitelisted` then rejects the request outright.
   * Without this, the one field that must pass through untouched is the one
   * field the pipe throws away, and every write fails with
   * "property value should not exist".
   */
  @Allow()
  value!: unknown;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Enter Effective From as YYYY-MM-DD' })
  effectiveFrom?: string | null;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Enter Effective To as YYYY-MM-DD' })
  effectiveTo?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'Change Reason is required' })
  @Transform(trim)
  @MaxLength(500)
  changeReason!: string;

  /** Required when updating; absent on the first write for a code. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class SetSettingStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ListSettingsDto {
  @IsOptional()
  @IsIn([...SETTING_CATEGORIES])
  category?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

export class ListChangeRequestsDto {
  @IsOptional()
  @IsIn([
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'APPLIED',
    'FAILED',
  ])
  status?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  settingCode?: string;
}

export class RejectChangeRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Rejection Reason is required' })
  @Transform(trim)
  @MaxLength(500)
  rejectionReason!: string;
}

export class UpsertBusinessCalendarDto {
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'Calendar Name is required' })
  @Transform(trim)
  @MaxLength(150)
  name!: string;

  /**
   * Accepted, but only one value is legal (Rule 16). Refusing the others
   * visibly beats hardcoding: widening it later becomes a deliberate change
   * rather than an invisible assumption.
   */
  @IsString()
  timezone!: string;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingDays?: number[];

  @IsOptional()
  @Matches(CLOCK_TIME, { message: 'Enter the EOD window start as HH:MM' })
  eodWindowStart?: string | null;

  @IsOptional()
  @Matches(CLOCK_TIME, { message: 'Enter the EOD window end as HH:MM' })
  eodWindowEnd?: string | null;

  @IsOptional()
  @IsBoolean()
  allowControlledRerun?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class AddHolidayDto {
  @Matches(ISO_DATE, { message: 'Enter the holiday date as YYYY-MM-DD' })
  holidayDate!: string;

  @IsString()
  @IsNotEmpty({ message: 'Holiday Name is required' })
  @Transform(trim)
  @MaxLength(150)
  name!: string;
}
