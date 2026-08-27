import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * The Branch Admin review decision (Scenarios 8, 9).
 *
 * Three decisions rather than a boolean, because the story's revision loop needs
 * "come back with better documents" to be different from "no". A rejected
 * customer is finished; a revision-required one is expected to return, and the
 * reason is what tells the branch what to fix.
 *
 * `reason` is conditionally required: mandatory for a revision or a rejection,
 * optional for an approval. A revision with no stated reason gives the branch
 * nothing to act on, which defeats the loop the source describes.
 */
export class ReviewKycDto {
  @IsIn(['APPROVE', 'REQUEST_REVISION', 'REJECT'], {
    message: 'A decision is required',
  })
  decision!: 'APPROVE' | 'REQUEST_REVISION' | 'REJECT';

  /**
   * `@ValidateIf` alone, with **no** `@IsOptional()`.
   *
   * The two cannot be combined: `@IsOptional()` skips every other validator when
   * the value is undefined, which is exactly the case this rule exists to catch.
   * With both present a revision submitted with no reason validated cleanly and
   * was accepted — the refusal Scenario 8 depends on simply did not happen.
   *
   * `@ValidateIf` returning false already skips validation for an approval, so
   * the optional case is covered without `@IsOptional()`.
   */
  @ValidateIf((dto: ReviewKycDto) => dto.decision !== 'APPROVE')
  @IsString({ message: 'A reason is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'A reason is required' })
  @MaxLength(1000)
  reason?: string;

  /** See `UpdateCustomerDto.expectedVersion` (Q-CUST-22, Scenario 40). */
  @IsString()
  @IsNotEmpty()
  expectedVersion!: string;
}
