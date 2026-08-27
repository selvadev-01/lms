import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Activate or deactivate an organization or a branch.
 *
 * One DTO for both directions, because an administrator trusted to take a
 * branch offline is necessarily trusted to put it back — splitting them would
 * imply an asymmetry the permission model does not have.
 *
 * The reason is optional but capped at the column width. It is what makes a
 * deactivation answerable months later without an audit-log query, so the UI
 * asks for one even though the API does not insist.
 */
export class SetStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'], {
    message: 'Status must be ACTIVE or INACTIVE',
  })
  status!: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;
}
