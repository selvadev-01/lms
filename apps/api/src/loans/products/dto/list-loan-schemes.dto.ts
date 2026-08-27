import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Scheme list filter.
 *
 * `selectable` serves the loan application wizard: the scheme picker at step 3
 * must offer only schemes an application may actually be created against, which
 * means ACTIVE, under an ACTIVE product, and carrying at least one active
 * duration option (Module 07 Rule 7, Scenario 10).
 *
 * It is a convenience for that caller, not a security control. The tenant
 * confinement is applied unconditionally in the service, and submit re-checks
 * every one of these conditions inside its own transaction — so a scheme
 * deactivated between the picker and the submit is still refused (Rule 72).
 *
 * Query strings carry no types, so `"true"` is compared explicitly rather than
 * relying on a transform that would make the string `"false"` truthy.
 */
export class ListLoanSchemesDto {
  @IsOptional()
  @IsUUID('4', { message: 'Unknown product filter' })
  productId?: string;

  @IsOptional()
  @Transform(trim)
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE'], { message: 'Unknown status filter' })
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  selectable?: boolean;
}
