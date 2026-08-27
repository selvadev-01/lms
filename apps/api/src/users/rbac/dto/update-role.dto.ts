import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Role edit — name and description only.
 *
 * Written out longhand rather than as `PartialType(CreateRoleDto)`, and the
 * omissions are the design:
 *
 * - `code` is immutable (see CreateRoleDto).
 * - `status` has its own endpoint and its own permission, so an administrator who
 *   may rename a role is not thereby able to activate one.
 * - `permissions` likewise, behind `roles.assign_permissions`.
 *
 * With `forbidNonWhitelisted` on the global pipe, sending any of the three is a
 * 400 rather than a silent discard — the client learns the field was refused
 * instead of believing a change took effect.
 */
export class UpdateRoleDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Role Name is required' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  description?: string;
}
