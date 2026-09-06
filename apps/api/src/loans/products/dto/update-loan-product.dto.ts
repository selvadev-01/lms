import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Loan product edit (Module 06).
 *
 * `code` is absent: it is the identifier schemes and applications were created
 * against, and changing it would retroactively alter what an existing record
 * refers to. `status` is absent for the same reason it is absent from create —
 * it has its own endpoint and its own permission.
 */
export class UpdateLoanProductDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Product Name is required' })
  @MaxLength(150)
  name!: string;

  /** A `LOAN_TYPE` master-data code — see `CreateLoanProductDto.loanType`. */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Loan Type is required' })
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'Loan Type is required' })
  loanType!: string;

  /**
   * The record's ISO `updatedAt`, as the caller last saw it.
   *
   * A mismatch is a 409 rather than a silent overwrite: two administrators
   * editing the same product must not have one of their changes disappear.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}
