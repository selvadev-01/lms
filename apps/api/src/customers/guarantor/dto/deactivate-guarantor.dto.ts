import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Guarantor deactivation (Module 05 Scenario 28).
 *
 * `reason` is required, unlike the customer's optional status reason.
 * Deactivation is what happens *instead of* a delete that was refused, so the
 * stated reason is the only record of why the non-destructive path was taken —
 * and Rule 34 makes deactivation the sanctioned answer to a blocked delete.
 */
export class DeactivateGuarantorDto {
  /**
   * Shares its message across `@IsString` and `@IsNotEmpty` so one mistake is
   * reported once — and deliberately does *not* use `@ValidateIf`, which would
   * skip the emptiness check entirely. See `create-guarantor.dto.ts`.
   */
  @MaxLength(500, { message: 'Reason must be 500 characters or fewer' })
  @IsString({ message: 'A reason is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'A reason is required' })
  reason!: string;

  @IsString()
  expectedVersion!: string;
}
