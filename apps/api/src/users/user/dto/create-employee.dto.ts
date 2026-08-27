import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';
import { CreateUserDto } from './create-user.dto';

/**
 * Add an employee — Scenarios 15, 16.
 *
 * Differs from an administrator in exactly two fields, and both become required:
 *
 * - `employeeCode`, whose presence is what makes the record an employee at all.
 *   Users and employees are one table; this column is the discriminator that the
 *   two API surfaces filter on.
 * - `branchId`, because field work happens somewhere (Q-RBAC-6). An employee with
 *   no branch could not be offered for a collection assignment, so allowing one
 *   would create a record that exists but can never be used.
 *
 * Redeclared rather than inherited-and-overridden for `branchId`: making an
 * optional parent field required in a subclass is expressible in class-validator
 * but reads as an accident, and the required-ness is the point here.
 */
export class CreateEmployeeDto extends CreateUserDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Employee ID is required' })
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Enter a valid Employee ID' })
  employeeCode!: string;

  @IsUUID('4', { message: 'Branch is required' })
  declare branchId: string;
}
