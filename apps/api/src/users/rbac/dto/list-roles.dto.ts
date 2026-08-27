import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Role list filter.
 *
 * `activeOnly` serves the role pickers on the user and employee forms: only an
 * ACTIVE role may be assigned as live authorization (Scenario 35), so offering a
 * DRAFT or INACTIVE one there invites a submission the server will refuse.
 *
 * A convenience for that caller, not a security control — tenant confinement is
 * applied unconditionally in `RoleService.list`, so omitting this widens nothing
 * that matters. Roles carry no branch scope, so there is no branch filter here.
 *
 * Query strings carry no types, so `"true"` is coerced explicitly rather than
 * relying on `transform`, which would make the string `"false"` truthy.
 */
export class ListRolesDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}
