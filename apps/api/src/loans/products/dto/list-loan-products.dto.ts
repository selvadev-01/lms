import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/** Loan product list filter. */
export class ListLoanProductsDto {
  @IsOptional()
  @Transform(trim)
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE'], { message: 'Unknown status filter' })
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE';

  /**
   * A `LOAN_TYPE` master-data code. Not checked against the tenant's list: this
   * is a filter, so an unrecognised code should return no rows rather than a
   * validation error — the same way an unmatched search term behaves.
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(50)
  loanType?: string;
}
