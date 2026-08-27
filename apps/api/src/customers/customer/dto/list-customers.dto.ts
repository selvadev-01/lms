import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Customer search and list filters (Scenarios 18-20).
 *
 * One `search` field rather than three, because the source describes a single
 * box over Name / ID / Phone. The service decides which column a term addresses;
 * making the caller choose would mean a user who typed a phone number into a
 * "name" box gets nothing back and concludes the customer does not exist.
 *
 * None of these is a security control. Tenant and branch confinement are applied
 * unconditionally in `CustomerService.list`, so omitting every filter widens
 * nothing that matters — the widest query a Branch Admin can express still
 * returns only their branch.
 */
export class ListCustomersDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(['KYC', 'LOCAL'])
  customerType?: 'KYC' | 'LOCAL';

  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED'])
  status?: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

  @IsOptional()
  @IsIn(['PENDING', 'SUBMITTED', 'REVISION_REQUIRED', 'APPROVED', 'REJECTED'])
  kycStatus?:
    'PENDING' | 'SUBMITTED' | 'REVISION_REQUIRED' | 'APPROVED' | 'REJECTED';
}
