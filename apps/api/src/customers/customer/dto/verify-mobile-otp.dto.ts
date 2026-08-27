import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * LOCAL mobile verification code (Scenario 14).
 *
 * Length is deliberately not validated. The server mints the code and knows its
 * own configured length; a client-side length rule would leak that configuration
 * and would have to be changed in two places whenever it moved.
 */
export class VerifyMobileOtpDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter the verification code' })
  @Matches(/^\d+$/, { message: 'Enter the verification code' })
  otp!: string;
}
