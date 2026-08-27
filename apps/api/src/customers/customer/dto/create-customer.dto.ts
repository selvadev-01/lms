import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Customer registration (Module 04, Scenarios 1-5).
 *
 * **There is no `orgId` field, and `branchId` is not what it looks like.** The
 * organization comes from the JWT and can never be supplied; the global pipe's
 * `forbidNonWhitelisted` turns an attempt into a 400, which is Scenario 30
 * enforced by configuration. `branchId` is accepted only because a Super Admin
 * carries no branch of their own and has to place the customer somewhere — a
 * caller who *has* a branch has theirs applied and this field ignored entirely
 * (see `CustomerService.resolveCreateBranch`). That is Scenario 31: a
 * branch-scoped user submitting another branch does not get it.
 *
 * Mandatory-field messages match the story's wording, because the web forms and
 * the e2e specs both assert on the rendered text.
 */
export class CreateCustomerDto {
  /**
   * Explicit, never inferred (Rule 5, Scenario 3). Its own message so a
   * submission missing the type fails on the type rather than on some
   * incidental field.
   */
  @IsIn(['KYC', 'LOCAL'], { message: 'Customer Type is required' })
  customerType!: 'KYC' | 'LOCAL';

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Full Name is required' })
  @MaxLength(200)
  fullName!: string;

  @Transform(trim)
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit mobile number',
  })
  mobile!: string;

  /** Required for LOCAL by Rule 11, and required for everyone in practice. */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Address is required' })
  @MaxLength(250)
  addressLine1!: string;

  /**
   * Optional contact address with no verification loop (Q-CUST-25). An empty
   * input is normalized to undefined rather than validated as an email, so an
   * untouched field is not an error.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    return trimmed === '' || trimmed === null ? undefined : trimmed;
  })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsISO8601({ strict: true }, { message: 'Enter a valid date of birth' })
  dateOfBirth?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  gender?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  addressLine2?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10)
  pincode?: string;

  /**
   * Where an organization-wide caller places the customer.
   *
   * Ignored for a branch-scoped caller, who always gets their own branch. This
   * is the field Scenario 31 is about, and the reason it is safe is that the
   * service never reads it when the actor carries a branch of their own.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;

  /**
   * Optional override of the generated customer code. Left unset in normal use;
   * present so a migration or a branch with its own numbering can supply one.
   */
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Enter a valid Customer ID' })
  @MaxLength(50)
  customerCode?: string;

  /**
   * Proceed despite a flagged duplicate (Scenario 5).
   *
   * Only a caller who has already been shown the matches can set this, because
   * the first attempt is refused with them listed. That is what makes the
   * duplicate visible without making a shared household number unusable
   * (Q-CUST-4, Q-CUST-5).
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  force?: boolean;
}
