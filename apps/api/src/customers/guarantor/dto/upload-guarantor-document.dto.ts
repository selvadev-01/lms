import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Guarantor document metadata (Scenario 20).
 *
 * The file itself travels as multipart and is validated by magic bytes
 * server-side — a client-supplied Content-Type is an assertion by the uploader,
 * not evidence.
 *
 * `documentNumber` is optional: a photo has no number, and an ID whose number is
 * unreadable should still reach a reviewer.
 */
export class UploadGuarantorDocumentDto {
  @IsIn(['ID', 'ADDRESS', 'PHOTO'], { message: 'Document Type is required' })
  documentType!: 'ID' | 'ADDRESS' | 'PHOTO';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  documentNumber?: string;
}
