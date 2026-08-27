import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Module 10 — repayment schedule DTOs.
 *
 * Follows `disbursement.dto.ts` in all of its conventions, including the one
 * that matters most: **`@ValidateIf` is never used on a required field**, since
 * it skips `@IsNotEmpty` and silently accepts a missing value. Nothing here
 * needs a conditional rule, so nothing here has one.
 *
 * **These DTOs, not the zod schemas, are what guard the API.** The schemas in
 * `packages/validation` run in the browser; a rule written only there is
 * enforced only there. The two are deliberately kept in step.
 *
 * Note what is absent. There is no DTO for editing an installment, because Rule
 * 24 forbids arbitrary edits of a generated EMI row and the way to enforce that
 * is to expose no endpoint rather than to validate one carefully (Scenario 15).
 * There is also no `branchId` anywhere: scope is resolved server-side from the
 * caller, and `forbidNonWhitelisted` turns an attempt to send one into a 400
 * (Scenario 35).
 */

export class ListRepaymentSchedulesDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUPERSEDED', 'CANCELLED'])
  status?: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';

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

/**
 * Supersede the live schedule with a new version.
 *
 * The reason is required. Scenario 43 asks the audit trail to retain why a
 * version was retired, and an optional reason is one that will be omitted,
 * leaving the entry unable to answer the only question ever asked of it.
 *
 * `@MaxLength` comes last so an empty string reports "required" rather than
 * passing a length check it trivially satisfies.
 */
export class RegenerateScheduleDto {
  @IsString({ message: 'Reason is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(500, { message: 'Reason must be 500 characters or fewer' })
  reason!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

/**
 * Download the schedule.
 *
 * Defaulting is left to the controller rather than expressed as a property
 * initializer: `forbidNonWhitelisted` plus an initializer would make the field
 * appear present when the caller omitted it, which reads as if the client had
 * chosen a format it never sent.
 */
export class ExportScheduleDto {
  @IsOptional()
  @IsIn(['csv', 'pdf'], { message: 'Format must be csv or pdf' })
  format?: 'csv' | 'pdf';
}
