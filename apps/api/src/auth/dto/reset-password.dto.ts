import { PASSWORD_MAX_LENGTH } from '@lms/validation';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Step 3 — establishing the new password.
 *
 * Deliberately carries no mobile, orgCode or userId. The account is identified
 * solely by the single-use reset authorization minted in step 2; accepting a
 * client-supplied identity here would let a valid token reset someone else's
 * password (Scenario 19).
 */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  // The token is 32 random bytes base64url-encoded (~43 chars); the cap only
  // needs to bound the hash input, not match the length exactly.
  @MaxLength(200)
  resetToken!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  /**
   * A cheap upper bound only — unbounded input would let a caller force
   * arbitrarily expensive argon2 work before any validation ran.
   *
   * The real policy (length, complexity, blocklist, account identifiers,
   * history) is enforced by PasswordPolicyService inside the reset flow, not
   * here. It needs the account to check identifiers and the database to check
   * history, neither of which a DTO decorator can reach, and splitting the
   * rules across both layers would let the two drift apart.
   */
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  })
  password!: string;
}
