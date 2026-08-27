import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Customer profile edit (Scenario 23's target).
 *
 * **One field, one endpoint.** No `customerType`, no `status`, no `customerCode`
 * and no `branchId`: type change is conversion, status change is activation, the
 * code is the customer's identity and the branch is not editable at all
 * (Q-CUST-14). Each of the first two has its own route and its own permission —
 * being allowed to correct a misspelled name is not thereby permission to
 * activate a customer.
 *
 * Sending any of them is a 400 rather than a silent no-op, because the pipe runs
 * `forbidNonWhitelisted`. A caller who believes they deactivated a customer
 * should be told they did not.
 */
export class UpdateCustomerDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Full Name is required' })
  @MaxLength(200)
  fullName!: string;

  /**
   * Changing this clears `mobileVerifiedAt` and can return a LOCAL customer to
   * PENDING (Q-CUST-28) — the verification belongs to the number, not to the
   * customer.
   */
  @Transform(trim)
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit mobile number',
  })
  mobile!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Address is required' })
  @MaxLength(250)
  addressLine1!: string;

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
   * The `updatedAt` the client last read (Q-CUST-22, Scenario 41).
   *
   * Required rather than optional: a write with no version handle cannot detect
   * a lost update, so making it optional would quietly reintroduce the race for
   * any caller who omitted it.
   */
  @IsString()
  @IsNotEmpty()
  expectedVersion!: string;
}
