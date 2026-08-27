import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Guarantor directory filters (GUA-001).
 *
 * One `search` field rather than three, matching `ListCustomersDto`: the source
 * describes one box, and the service decides which column a term addresses.
 * Making the caller pick would mean someone who typed a mobile number into the
 * "name" box gets nothing.
 *
 * No `orgId` or `branchId` — both come from the JWT. A caller who could name a
 * branch here would be choosing their own scope (Rule 9).
 */
export class ListGuarantorsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsIn([
    'NOT_REQUIRED',
    'PENDING',
    'SUBMITTED',
    'REVISION_REQUIRED',
    'APPROVED',
    'REJECTED',
  ])
  kycStatus?:
    | 'NOT_REQUIRED'
    | 'PENDING'
    | 'SUBMITTED'
    | 'REVISION_REQUIRED'
    | 'APPROVED'
    | 'REJECTED';

  @IsOptional()
  @IsIn(['PENDING', 'GIVEN', 'REJECTED'])
  consentStatus?: 'PENDING' | 'GIVEN' | 'REJECTED';

  /** Narrows to one borrower — "who guaranteed this customer". */
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
