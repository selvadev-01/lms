import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Step 2 — verifying the recovery OTP.
 *
 * The mobile number is re-submitted rather than held in a server-side session:
 * the OTP alone is not an identity, and pinning the verification to the same
 * account the request was raised for stops a code delivered to one number being
 * redeemed against another.
 */
export class VerifyOtpDto {
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

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Verification Code is required' })
  // Fixed length, so an over-long value is rejected before it reaches argon2.
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit verification code' })
  otp!: string;
}
