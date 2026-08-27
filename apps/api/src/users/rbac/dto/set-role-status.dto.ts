import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Role activation and deactivation — "Save & Activate" and its reverse.
 *
 * `DRAFT` is accepted as a target so a role can be returned to configuration
 * without being deleted, but the meaningful transition is DRAFT → ACTIVE, which
 * is the source-defined Save & Activate step (Scenario 30). The service refuses
 * activating a role with no permissions: an active role that grants nothing is
 * indistinguishable from a misconfiguration.
 */
export class SetRoleStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE'], {
    message: 'Status must be DRAFT, ACTIVE or INACTIVE',
  })
  status!: 'DRAFT' | 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;
}
