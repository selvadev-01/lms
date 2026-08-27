import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Activate or deactivate an account — Scenarios 8, 12, 13, 21, 49.
 *
 * One DTO for both directions, as Module 02 does: an administrator trusted to
 * take an account offline is necessarily trusted to put it back.
 *
 * `LOCKED` and `SUSPENDED` are absent. A lock is something the authentication
 * module applies in response to failed sign-in attempts and lifts on its own
 * schedule; letting an administrator set it here would produce a lock nothing
 * ever clears. Deactivation is the administrative tool, and it is reversible.
 *
 * The reason is optional but capped at the column width. It is what makes a
 * deactivation answerable months later without an audit-log query.
 */
export class SetUserStatusDto {
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
