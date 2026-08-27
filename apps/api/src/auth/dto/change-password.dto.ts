import { PASSWORD_MAX_LENGTH } from '@lms/validation';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Change Password — an authenticated user replacing their own credential.
 *
 * Carries no userId, orgId, mobile or orgCode. The account is whoever the
 * session says it is: the handler reads identity from `@CurrentUser()` alone.
 * Scenario 29 ("the user cannot substitute another user's ID through
 * client-controlled input") therefore holds structurally — there is nowhere in
 * this shape to put such an ID, and the global ValidationPipe runs with
 * `forbidNonWhitelisted`, so a request that invents one is rejected outright.
 *
 * `confirmNewPassword` is absent for the same reason it is absent from
 * ResetPasswordDto: it is a UI guard against typing a typo into a masked field,
 * checked by the Server Action, and never transmitted.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current Password is required' })
  /**
   * Presence and a length bound only — never the password policy.
   *
   * An account whose password predates a policy tightening must still be able
   * to use this screen; validating the *existing* credential against the
   * *current* policy would lock such a user out of the one flow that would fix
   * it. Correctness is established by verifying it against the stored hash.
   */
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  })
  currentPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'New Password is required' })
  /**
   * A cheap upper bound only — unbounded input would let a caller force
   * arbitrarily expensive argon2 work before any validation ran.
   *
   * The real policy (length, complexity, blocklist, account identifiers,
   * history) is enforced by PasswordPolicyService inside the change flow, not
   * here, for the reasons documented on ResetPasswordDto.
   */
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  })
  newPassword!: string;
}
