import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Branch create (Module 02 Scenario 17, and the mandatory-field outline).
 *
 * There is no `organizationId` field: the parent is the caller's own
 * organization, taken from the JWT. Accepting one would make Rule 28 — a
 * client-supplied scope must never override the authenticated scope — a
 * runtime check rather than a structural guarantee.
 */
export class CreateBranchDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Branch Code is required' })
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Enter a valid Branch Code' })
  code!: string;

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

  @IsIn(['ACTIVE', 'INACTIVE'], {
    message: 'Branch Status is required',
  })
  status!: 'ACTIVE' | 'INACTIVE';
}
