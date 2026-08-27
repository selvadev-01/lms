import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';
import { REPORT_CATEGORIES, REPORT_DATE_BASES } from './reports.dto';

/**
 * Saved report definition shapes.
 *
 * As everywhere in this module, there is no `orgId` and no `ownerUserId`: the
 * organization comes from the JWT and the owner is whoever is making the
 * request. A caller cannot save a definition into another tenant, or attribute
 * one to another user, because there is no field through which to try.
 *
 * `branchId` is present for the same reason it is on the report queries — an
 * organization-wide user legitimately saves a per-branch definition — and is
 * validated against the caller's scope by the service rather than accepted.
 */

const REPORT_VISIBILITIES = ['PRIVATE', 'SHARED'] as const;
const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class SaveReportDto {
  @IsString({ message: 'Report Name is required' })
  @Transform(trim)
  @MaxLength(150, { message: 'Report Name must be 150 characters or fewer' })
  name!: string;

  @IsEnum(REPORT_CATEGORIES, { message: 'Report Type is required' })
  category!: (typeof REPORT_CATEGORIES)[number];

  @IsEnum(REPORT_VISIBILITIES, { message: 'Visibility is required' })
  visibility!: (typeof REPORT_VISIBILITIES)[number];

  @IsEnum(REPORT_DATE_BASES, { message: 'Date Basis is required' })
  dateBasis!: (typeof REPORT_DATE_BASES)[number];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'From Date must be a valid date' })
  fromDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'To Date must be a valid date' })
  toDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;
}

/**
 * Editing a definition.
 *
 * `expectedVersion` is what makes a stale edit a refusal rather than a silent
 * overwrite (Scenario 59). It is required, not optional: an update with no
 * version is an update that cannot be checked.
 */
export class UpdateSavedReportDto extends SaveReportDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required' })
  @Min(1)
  expectedVersion!: number;
}

/** Deactivation carries nothing but the version it expects. */
export class VersionedDto {
  @Type(() => Number)
  @IsInt({ message: 'Version is required' })
  @Min(1)
  expectedVersion!: number;
}

export class ListSavedReportsDto {
  @IsOptional()
  @IsEnum(RECORD_STATUSES)
  status?: (typeof RECORD_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  search?: string;

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
