import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/** Loan product list filter. */
export class ListLoanProductsDto {
  @IsOptional()
  @Transform(trim)
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE'], { message: 'Unknown status filter' })
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @Transform(trim)
  @IsIn(['PERSONAL', 'BUSINESS', 'GOLD', 'VEHICLE'], {
    message: 'Unknown loan type filter',
  })
  loanType?: 'PERSONAL' | 'BUSINESS' | 'GOLD' | 'VEHICLE';
}
