import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Loan scheme create (Module 06).
 *
 * The interest rate is an integer basis-point string, never a number. 12.5% is
 * `"1250"`, and the string survives the wire exactly; a JSON number would be a
 * float, and a float is not a thing to price a loan book with. The service
 * parses it with `BigInt`.
 */
export class CreateLoanSchemeDto {
  @IsUUID('4', { message: 'Select a loan product' })
  loanProductId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Scheme Code is required' })
  @MaxLength(50)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message: 'Scheme Code may use A-Z, 0-9, hyphen and underscore only',
  })
  code!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Scheme Name is required' })
  @MaxLength(150)
  name!: string;

  /** Module 07 Rule 5: Flat, Reducing and Custom Rate. */
  @IsIn(['FLAT', 'REDUCING', 'CUSTOM_RATE'], {
    message: 'Interest Type is required',
  })
  interestType!: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Interest Rate is required' })
  @Matches(/^\d+$/, {
    message: 'Interest Rate must be a whole number of basis points',
  })
  @MaxLength(10)
  interestRateBps!: string;
}
