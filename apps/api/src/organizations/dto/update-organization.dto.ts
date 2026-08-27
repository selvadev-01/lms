import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Company Settings edit (Module 02 Scenario 6).
 *
 * `code` and `status` are absent deliberately. `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so sending either is a 400 rather than a silent
 * no-op: the organization code is the tenant's identity and is quoted at
 * sign-in, and status changes belong to `POST /organizations/me/status`, which
 * carries its own audit action.
 */
export class UpdateOrganizationDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Organization Name is required' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(250)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(64)
  timezone?: string;
}
