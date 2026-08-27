import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Activate or deactivate a loan product or scheme (Module 06).
 *
 * One DTO for both directions and both entities, following `SetStatusDto` in
 * Module 02: an administrator trusted to withdraw a scheme from lending is
 * necessarily trusted to reinstate it.
 *
 * Deactivating a scheme stops *new* applications selecting it (Module 07
 * Scenario 38). It does not touch applications already created against it —
 * their terms were copied at creation, and Scenario 39 requires those to stand.
 */
export class SetLoanConfigStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'], {
    message: 'Status must be ACTIVE or INACTIVE',
  })
  status!: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}
