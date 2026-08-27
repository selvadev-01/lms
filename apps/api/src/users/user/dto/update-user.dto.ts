import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Edit a user or employee — Scenarios 5, 6, 7.
 *
 * Name and email only. Written out longhand rather than as
 * `PartialType(CreateUserDto)`, and every omission is deliberate:
 *
 * - `mobile` is the login identifier. Changing it is an identity change, not a
 *   profile edit, and Q-REC-21 leaves it to a dedicated flow.
 * - `status`, `roleIds` and `branchId` each have their own endpoint and their own
 *   permission, so an administrator who may correct a misspelt name is not
 *   thereby able to deactivate the account or grant it a role.
 * - `employeeCode` identifies the employee in historical records.
 *
 * With `forbidNonWhitelisted`, sending any of them is a 400 rather than a silent
 * discard — the client learns the field was refused instead of believing the
 * change took effect (Scenario 7: an edit must not rewrite anything downstream).
 */
export class UpdateUserDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Full Name is required' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(320)
  email?: string;
}
