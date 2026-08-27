import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Step 1 — a password-recovery request.
 *
 * Carries no password field, and `forbidNonWhitelisted` on the global
 * ValidationPipe means one submitted anyway is a 400 rather than a silently
 * ignored extra: the screen exists because the password is unavailable
 * (Forgot Password rule 5).
 */
export class ForgotPasswordDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Organization Code is required' })
  @MaxLength(50)
  orgCode!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Mobile Number is required' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit mobile number' })
  mobile!: string;
}
