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
 * Per-document review, separate from the overall KYC decision.
 *
 * `PENDING` is deliberately not accepted: a reviewer moves a document forward or
 * back, but "I have decided it is undecided" is not a review outcome, and
 * allowing it would let an approved document silently return to the queue.
 *
 * A rejection requires a reason for the same reason a KYC revision does — the
 * branch has to know which document to replace and why.
 */
export class VerifyDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'], {
    message: 'A verification decision is required',
  })
  status!: 'VERIFIED' | 'REJECTED';

  /**
   * `@ValidateIf` without `@IsOptional()` — see `review-kyc.dto.ts` for why the
   * two cannot be combined. With both present, a rejection carrying no reason
   * was silently accepted.
   */
  @ValidateIf((dto: VerifyDocumentDto) => dto.status === 'REJECTED')
  @IsString({ message: 'A reason is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'A reason is required' })
  @MaxLength(1000)
  reason?: string;
}
