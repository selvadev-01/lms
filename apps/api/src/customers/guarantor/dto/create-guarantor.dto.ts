import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Guarantor details (Module 04 Scenario 24; Module 05 Scenarios 6, 9).
 *
 * `consentStatus` is absent on purpose. Consent is a separate, deliberate act
 * recorded through its own endpoint (Scenario 25); accepting it here would let a
 * guarantor be created already consenting, recording an agreement nobody gave.
 *
 * No `customerId`, `orgId` or `branchId` either — all three come from the route
 * and the JWT. `forbidNonWhitelisted` turns an attempt to send one into a 400,
 * which is how Scenarios 14 and 36 are enforced by configuration rather than by
 * a check somebody has to remember.
 */
export class CreateGuarantorDto {
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

  /**
   * Required, unlike the customer's address. Module 05 Rule 13 and the
   * Scenario 9 outline both name "Address is required" for a guarantor.
   *
   * class-validator runs every decorator against an absent value and
   * concatenates the failures, so an omitted address trips the length rule too.
   * Decorators evaluate bottom-up, so `@MaxLength` sits **last** in source
   * order to be evaluated first — leaving "Address is required" at the head of
   * the array, which is the one message the web form renders.
   *
   * **Do not reach for `@ValidateIf` to tidy this up.** A false predicate skips
   * *every* remaining validator on the property, `@IsNotEmpty` included, so an
   * omitted address is silently accepted — which is how a guarantor with no
   * address got created during smoke testing.
   */
  @MaxLength(500, { message: 'Address must be 500 characters or fewer' })
  @IsString({ message: 'Address is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Address is required' })
  address!: string;

  /** Free text: the source names the field but enumerates no values. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  relationship?: string;

  /**
   * Acknowledges a duplicate warning rather than describing the guarantor
   * (Scenario 10, Q-GUAR-4). A guarantor sharing a mobile with one already on
   * the same customer is refused with a 409 until the caller repeats the request
   * with this set, and the override is audited distinctly from a clean create.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
