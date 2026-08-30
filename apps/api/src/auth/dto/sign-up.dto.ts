import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Public organization signup.
 *
 * Five fields, deliberately. Branch details are not asked for — the server
 * creates a default branch the new administrator completes afterwards — because
 * the point of this form is that someone can get a working organization in one
 * screen.
 *
 * `confirmPassword` is absent on purpose. It is a browser affordance with no
 * server meaning: the API receives one password and either accepts it or does
 * not, and checking that two strings the same client sent match each other
 * proves nothing. The rule is enforced in `@lms/validation`, which both the
 * browser and the Server Action run.
 *
 * Trimming is server-side for the same reason as `SignInDto`: leading and
 * trailing whitespace must not create a separate identity, and that is a
 * storage-level guarantee rather than a form-level one.
 */
export class SignUpDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Organization Name is required' })
  @MaxLength(200)
  orgName!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Organization Code is required' })
  @MaxLength(50)
  // Letters, digits, hyphen and underscore. Uppercased by the service before
  // the uniqueness check — `Organization.code` is a plain unique column, so
  // `acme` and `ACME` would otherwise be two tenants nobody could tell apart at
  // the sign-in screen.
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message:
      'Organization Code may contain only letters, digits, hyphens and underscores',
  })
  orgCode!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Your Name is required' })
  @MaxLength(200)
  adminName!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Mobile Number is required' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit mobile number' })
  adminMobile!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  // Unbounded input would let a caller force arbitrarily expensive argon2 work.
  @MaxLength(200)
  password!: string;
}
