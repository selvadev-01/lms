import { Transform, Type } from 'class-transformer';
import {
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Audit list and export filters (Scenario 38).
 *
 * Every field here is a REQUEST, never a `where` clause. `AuditQueryService`
 * builds the query from the authenticated session and narrows it with these —
 * `orgId` appears nowhere because it is the tenant boundary and comes from the
 * JWT, and `branchId` is checked against the caller's own scope rather than
 * trusted.
 */
export class ListAuditDto {
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(150)
  action?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Enter From Date as YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'Enter To Date as YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
