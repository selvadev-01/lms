import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Loan product create (Module 06).
 *
 * No `orgId`: the parent is the caller's own organization, taken from the JWT.
 * Accepting one would make the tenancy rule a runtime check rather than a
 * structural guarantee, and `forbidNonWhitelisted` turns an attempt to send one
 * into a 400.
 *
 * No `status` either. A product is created as DRAFT and moved to ACTIVE through
 * its own endpoint under `loans.products.activate`, so being allowed to define a
 * product is not thereby permission to put it into lending.
 *
 * Decorator order is deliberate throughout: `@IsNotEmpty` sits before
 * `@MaxLength` and `@Matches` so a blank submission reports "X is required"
 * rather than a pattern complaint about the empty string.
 */
export class CreateLoanProductDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Product Code is required' })
  @MaxLength(50)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message: 'Product Code may use A-Z, 0-9, hyphen and underscore only',
  })
  code!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Product Name is required' })
  @MaxLength(150)
  name!: string;

  /**
   * A `LOAN_TYPE` master-data code (Module 07 Rule 4, Scenario 9).
   *
   * Was `@IsIn(['PERSONAL','BUSINESS','GOLD','VEHICLE'])`. The list is per-tenant
   * master data now, so a fixed list here would refuse a type the tenant defined
   * for itself. Only the shape is checked at this layer; that the code names an
   * ACTIVE `LOAN_TYPE` row in *this* org is checked by `LoanProductService`,
   * which is the only layer that can ask.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Loan Type is required' })
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'Loan Type is required' })
  loanType!: string;
}
