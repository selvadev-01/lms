import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Create an administrator account — Scenarios 2, 3, 4, 48, 58.
 *
 * **No `orgId`.** Organization comes from the JWT, which is what makes Scenario 4
 * ("a user cannot be created outside the authorized organization scope")
 * structural rather than a check someone could forget to write. With
 * `forbidNonWhitelisted` on the global pipe, sending one is a 400.
 *
 * **Password is optional.** Omitting it provisions the account without one —
 * `User.passwordHash` is nullable precisely so that is possible, and `PENDING`
 * is what records it. Supplying one makes the account immediately usable and
 * flags it `mustChangePassword`, because a password an administrator chose is
 * known to two people until the user replaces it.
 *
 * Rule 48 still holds: the hashing, the policy check and the forced-change gate
 * all live in the authentication module. This DTO carries the plaintext exactly
 * as far as `UserService.create`, which hands it straight to `PasswordService`.
 *
 * `branchId` IS accepted, and does not weaken the scope rule: naming a branch
 * confines the new user rather than widening anyone, and the service still
 * refuses a branch outside the actor's own reach (Scenario 18).
 */
export class CreateUserDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Full Name is required' })
  @MaxLength(200)
  name!: string;

  /**
   * The login identifier. Validated to the same shape as sign-in's, so a number
   * accepted here cannot be one that later fails to authenticate.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Mobile Number is required' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit mobile number',
  })
  mobile!: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;

  /**
   * Role assignment is explicit (Rule 19): an account with no role grants
   * nothing and cannot be reasoned about, so it is not a state this endpoint
   * will produce.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'Role is required' })
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true, message: 'Select a valid role' })
  roleIds!: string[];

  /**
   * `ACTIVE` is accepted but the service refuses it for an account with no
   * password — a live account nobody can sign in to is a support ticket waiting
   * to happen. `LOCKED` is absent: lockout is something the authentication module
   * does in response to failed attempts, not something an administrator sets.
   */
  @IsIn(['PENDING', 'ACTIVE', 'INACTIVE'], {
    message: 'Account Status is required',
  })
  status!: 'PENDING' | 'ACTIVE' | 'INACTIVE';

  /**
   * The account's first password, chosen by the administrator creating it.
   *
   * Optional, and omitting it keeps the previous behaviour exactly: no hash, and
   * `PENDING`. Supplying one activates the account and sets `mustChangePassword`,
   * so the borrowed credential buys access to Change Password and nothing else.
   *
   * Bounded for the same reason sign-in's is: unbounded input lets a caller
   * force arbitrarily expensive argon2 work. The policy itself (length,
   * character classes, not containing the account's own identifiers) is checked
   * in the service by `PasswordPolicyService`, which owns those rules.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200)
  password?: string;
}
