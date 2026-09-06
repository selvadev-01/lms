import { IsUUID } from 'class-validator';

import { CreateUserDto } from './create-user.dto';

/**
 * Add an employee — Scenarios 15, 16.
 *
 * Differs from an administrator in exactly two ways:
 *
 * - `employeeCode`, whose presence is what makes the record an employee at all.
 *   Users and employees are one table; this column is the discriminator that the
 *   two API surfaces filter on. **It is not an input.** The server allocates it
 *   (`UserService.nextEmployeeCode`) so that the discriminator can never be
 *   absent, malformed, or chosen to collide with an existing employee. A client
 *   that posts one is ignored rather than refused — `forbidNonWhitelisted` is
 *   not on globally, and silently dropping an unowned field is the same
 *   treatment the branch-scoping rules give a client-supplied `orgId`.
 * - `branchId`, because field work happens somewhere (Q-RBAC-6). An employee with
 *   no branch could not be offered for a collection assignment, so allowing one
 *   would create a record that exists but can never be used.
 *
 * Redeclared rather than inherited-and-overridden for `branchId`: making an
 * optional parent field required in a subclass is expressible in class-validator
 * but reads as an accident, and the required-ness is the point here.
 */
export class CreateEmployeeDto extends CreateUserDto {
  @IsUUID('4', { message: 'Branch is required' })
  declare branchId: string;
}
