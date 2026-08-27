import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

/**
 * A repayment option a scheme supports: one frequency at one period count
 * (Module 06; Module 07 Rule 8 and Scenario 11).
 *
 * The pair is the unit, not the frequency alone — a scheme may offer 6, 12 and
 * 24 monthly periods, and each is its own row. An application whose
 * frequency/duration pair has no active row here is refused at submit, which is
 * what Scenario 11 asks for.
 */
export class CreateSchemeDurationDto {
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], {
    message: 'Frequency is required',
  })
  frequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

  /**
   * `@Type` is required for a JSON body too: without it a client sending
   * `"12"` as a string fails `@IsInt` rather than being coerced, and a form
   * posting through the web layer is exactly the caller that would.
   *
   * The upper bound matches the EMI calculator's own limit, so a duration this
   * accepts is always one the calculator can build a schedule for.
   */
  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of periods' })
  @Min(1, { message: 'Duration must be at least one period' })
  @Max(10_000, { message: 'Duration is too long' })
  durationCount!: number;
}

/**
 * Activate or deactivate one duration option.
 *
 * Carries no `expectedVersion`: `LoanSchemeDuration` has no `updatedAt` column
 * to derive one from, and the row holds a single mutable field whose two values
 * are both idempotent. A concurrent pair of writers here agree by construction,
 * which is not true of the scheme itself.
 */
export class UpdateSchemeDurationDto {
  @IsIn(['ACTIVE', 'INACTIVE'], {
    message: 'Status must be ACTIVE or INACTIVE',
  })
  status!: 'ACTIVE' | 'INACTIVE';
}
