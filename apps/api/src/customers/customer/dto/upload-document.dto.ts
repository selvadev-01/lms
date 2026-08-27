import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * KYC document upload metadata (Scenario 6).
 *
 * The file itself travels as multipart and is **not** described here. Its type
 * is decided by magic bytes server-side (Q-CUST-16) rather than by anything in
 * this DTO or in the request headers: a client-supplied `Content-Type` is an
 * assertion by the uploader, not evidence.
 *
 * `documentNumber` is optional (Q-CUST-17) — a photograph has no number, and an
 * ID whose number is unreadable should still reach a reviewer who can decide
 * what to do about it.
 */
export class UploadDocumentDto {
  @IsIn(['ID', 'ADDRESS', 'PHOTO'], { message: 'Document Type is required' })
  documentType!: 'ID' | 'ADDRESS' | 'PHOTO';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  documentNumber?: string;
}
