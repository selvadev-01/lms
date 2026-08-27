import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Branch list filter.
 *
 * `activeOnly` serves the operational branch selector (Scenario 50): a picker
 * offering a new customer, loan or collection must not list an inactive branch.
 * It is a convenience for that caller, not a security control — the tenant and
 * branch confinement is applied unconditionally in `BranchService.list`, so
 * omitting this parameter widens nothing that matters.
 *
 * Query strings carry no types, so `"true"` is coerced explicitly rather than
 * relying on `transform`, which would make the string `"false"` truthy.
 */
export class ListBranchesDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}
