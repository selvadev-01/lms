import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Sign-in credentials.
 *
 * Trimming is applied server-side, not just in the browser: Scenario 27
 * (whitespace-only mobile is rejected) has to hold against a direct API call,
 * and rule "leading/trailing whitespace must not create a separate identity"
 * is a storage-level guarantee.
 */
export class SignInDto {
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
  @IsNotEmpty({ message: 'Password is required' })
  // Unbounded input would let a caller force arbitrarily expensive argon2 work.
  @MaxLength(200)
  password!: string;
}
