import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Customer activation and deactivation (Q-CUST-11).
 *
 * Carries the target state rather than being a toggle, so a stale client cannot
 * flip a customer it believed was active into the opposite of what the operator
 * intended. `BLOCKED` is accepted here but is not reachable from the UI in this
 * pass — it exists in the enum for a compliance hold, and refusing it at the DTO
 * would mean adding it later needs a schema change as well as a UI one.
 *
 * Activation is refused for an unverified LOCAL customer or an unapproved KYC
 * customer; that rule lives in the service, because it depends on the record
 * rather than on the request.
 */
export class SetCustomerStatusDto {
  @IsIn(['PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED'], {
    message: 'Customer Status is required',
  })
  status!: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
