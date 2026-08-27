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
 * Per-document review of a guarantor's KYC pack.
 *
 * `PENDING` is deliberately not accepted, as in `VerifyDocumentDto`: a reviewer
 * moves a document forward or back, but "I have decided it is undecided" is not
 * a review outcome, and allowing it would let a verified document silently
 * return to the queue.
 */
export class VerifyGuarantorDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'], {
    message: 'A verification decision is required',
  })
  status!: 'VERIFIED' | 'REJECTED';

  /**
   * `@ValidateIf` without `@IsOptional()` — the two cannot be combined. With
   * both present, `@IsOptional()` short-circuits the chain whenever the value is
   * absent, so a rejection carrying no reason was silently accepted. That bug is
   * recorded in `verify-document.dto.ts`; this file must not reintroduce it.
   */
  @ValidateIf((dto: VerifyGuarantorDocumentDto) => dto.status === 'REJECTED')
  @IsString({ message: 'A reason is required' })
  @Transform(trim)
  @IsNotEmpty({ message: 'A reason is required' })
  @MaxLength(1000)
  reason?: string;
}
