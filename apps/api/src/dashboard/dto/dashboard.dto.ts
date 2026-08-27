import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * The dashboard's only input.
 *
 * # What is absent is the design
 *
 * There is no `orgId`: the organization comes from the JWT, so a request for
 * another organization's dashboard has nowhere to put the identifier. Rule 2
 * is satisfied by the shape rather than by a check that could be forgotten.
 *
 * There is no `businessDate` and no `asOf`. Rule 16 requires the authoritative
 * business date, and the overdue module documents why it must not come from the
 * client: a wrong device clock would otherwise move a borrower into or out of
 * the overdue book. The specification's mandatory-field table asks for a
 * "Business Date is required for this view" message; that row is satisfied
 * *inverted* — the field is not accepted, so it can never be missing, and a
 * message about it could never be shown because the state cannot arise.
 *
 * `branchId` is a *request*, not an instruction. `resolveBranchScope` narrows
 * it to what the caller may read or refuses it outright (Scenario 7).
 *
 * # Why these validators and not the zod schema
 *
 * `@lms/validation` carries the same rules for the browser. They are restated
 * here because that package is not what guards the API — a rule written only
 * there is enforced only there, which has already produced one accepted request
 * the web would have rejected.
 */
export class DashboardWidgetQueryDto {
  /**
   * Omitted means month-to-date. Validated as an enum so an unknown period is
   * refused rather than silently treated as the default: substituting one would
   * return a number for a range the caller never asked for.
   */
  @IsOptional()
  @IsEnum(['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'], {
    message: 'Period is not a supported value',
  })
  periodType?: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

  /**
   * Read only when `periodType` is `CUSTOM`; the presets are derived on the
   * server. Optional here and *conditionally required* in
   * `resolveDashboardPeriod`, because demanding them unconditionally would
   * force every screen to post dates the server ignores.
   *
   * `@Matches` rather than `@IsDateString`: the latter accepts a full ISO
   * timestamp, and a time component on a DATE-only business field is exactly
   * the ambiguity Rule 15 exists to remove.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Period Start Date must be a valid date',
  })
  fromDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Period End Date must be a valid date',
  })
  toDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;
}

/** The layout request. Scope only — no widget carries data at this stage. */
export class DashboardLayoutQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Select a valid branch' })
  branchId?: string;
}
