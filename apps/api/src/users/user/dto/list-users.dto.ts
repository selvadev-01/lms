import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * User and employee list filters.
 *
 * `activeOnly` serves the field-collection selector (Scenarios 20, 53): a picker
 * offering an employee for new work must not list a deactivated one.
 *
 * `roleCode` narrows to a single role, which is how the same selector asks for
 * Field Employees specifically.
 *
 * Neither is a security control. Tenant and branch confinement are applied
 * unconditionally in `UserService.list`, and the users/employees split is decided
 * by the controller rather than by a query parameter — so omitting both widens
 * nothing that matters.
 *
 * Query strings carry no types, so `"true"` is coerced explicitly rather than
 * relying on `transform`, which would make the string `"false"` truthy.
 */
export class ListUsersDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleCode?: string;
}
