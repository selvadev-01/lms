import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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

  /**
   * An inclusive range of accepted counts, for a term the borrower states rather
   * than picks from a list — a daily loan runs to a date, so its count is
   * whatever those dates imply.
   *
   * Both or neither. One bound alone would behave as an exact term while
   * appearing to be a range, so `validateRange` below refuses it rather than
   * letting the caller believe a range was recorded. The database repeats the
   * rule as a CHECK constraint, which is what actually guarantees it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Minimum duration must be a whole number of periods' })
  @Min(1, { message: 'Minimum duration must be at least one period' })
  @Max(10_000, { message: 'Minimum duration is too long' })
  minDurationCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Maximum duration must be a whole number of periods' })
  @Min(1, { message: 'Maximum duration must be at least one period' })
  @Max(10_000, { message: 'Maximum duration is too long' })
  maxDurationCount?: number;
}

/**
 * The cross-field rules a decorator cannot express.
 *
 * Returns the message to refuse with, or null. Kept next to the DTO rather than
 * in the service so the shape rules stay in one place, and exported so the spec
 * can drive it directly.
 */
export function validateSchemeDurationRange(
  dto: Pick<
    CreateSchemeDurationDto,
    'durationCount' | 'minDurationCount' | 'maxDurationCount'
  >,
): string | null {
  const { minDurationCount: min, maxDurationCount: max, durationCount } = dto;

  if (min === undefined && max === undefined) return null;

  if (min === undefined || max === undefined) {
    return 'Give both a minimum and a maximum duration, or neither';
  }

  if (min > max) {
    return 'Minimum duration cannot exceed the maximum';
  }

  // The default is what the application form pre-fills. Outside its own range it
  // would offer the user a value the submit gate then refuses.
  if (durationCount < min || durationCount > max) {
    return 'Default duration must fall within the minimum and maximum';
  }

  return null;
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
