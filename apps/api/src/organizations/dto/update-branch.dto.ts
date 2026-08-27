import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Branch edit (Module 02 Scenario 20).
 *
 * Spelled out rather than derived from `CreateBranchDto`, because the two
 * fields that differ are the point: `code` and `status` are absent, not
 * optional. The branch code scopes the gapless receipt sequence, so changing it
 * would retroactively alter what an already-issued receipt number refers to
 * (Scenario 39); status moves through `POST /branches/:id/status`, which is a
 * different permission and a different audit action.
 *
 * With `forbidNonWhitelisted`, sending either is a 400 — the caller is told the
 * field is not editable rather than watching it be quietly discarded.
 */
export class UpdateBranchDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Branch Name is required' })
  @MaxLength(200)
  name!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Address is required' })
  @MaxLength(250)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(250)
  addressLine2?: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'City is required' })
  @MaxLength(100)
  city!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'State is required' })
  @MaxLength(100)
  state!: string;

  @IsString()
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Enter a valid 6-digit pincode' })
  pincode!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Transform(trim)
  @MaxLength(255)
  contactEmail?: string;
}
