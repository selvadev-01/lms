import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * LOCAL to KYC conversion (Scenario 27).
 *
 * **Carries no target type.** The only permitted direction is LOCAL to KYC, so
 * there is nothing for the caller to choose. A `customerType` field here would
 * make KYC to LOCAL expressible, which would let an approved customer's
 * verification be discarded by a type change — turning conversion into a way to
 * erase a KYC record rather than to start one.
 */
export class ConvertCustomerTypeDto {
  /** See `UpdateCustomerDto.expectedVersion` (Q-CUST-22). */
  @IsString()
  @IsNotEmpty()
  expectedVersion!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
