import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Loan scheme edit (Module 06).
 *
 * `loanProductId` is absent: moving a scheme between products would silently
 * re-type every application already created against it, since an application
 * reads its loan type through the product rather than storing one.
 *
 * Editing the rate here changes the rate offered to *new* applications only.
 * Applications already created copied the rate onto themselves at creation, and
 * that copy is what makes Module 07 Scenario 39 hold — existing terms do not
 * move when a scheme is repriced.
 */
export class UpdateLoanSchemeDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Scheme Name is required' })
  @MaxLength(150)
  name!: string;

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

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}
