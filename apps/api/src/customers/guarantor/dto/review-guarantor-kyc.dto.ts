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
 * The guarantor KYC decision (Scenarios 23, 24).
 *
 * A revision or rejection must say why: the reason is what the branch acts on
 * when resubmitting, and Scenario 23 requires it be retained.
 */
export class ReviewGuarantorKycDto {
  @IsIn(['APPROVE', 'REQUEST_REVISION', 'REJECT'], {
    message: 'A decision is required',
  })
  decision!: 'APPROVE' | 'REQUEST_REVISION' | 'REJECT';

  /**
   * `@ValidateIf` without `@IsOptional()` — see `verify-document.dto.ts`. With
   * both present, a revision carrying no reason is silently accepted.
   */
  @ValidateIf((dto: ReviewGuarantorKycDto) => dto.decision !== 'APPROVE')
  @IsString({ message: 'A reason is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'A reason is required' })
  @MaxLength(1000)
  reason?: string;

  @IsString()
  expectedVersion!: string;
}
