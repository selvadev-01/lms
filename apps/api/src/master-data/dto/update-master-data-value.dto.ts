import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Edit a value's presentation or lifecycle.
 *
 * **`code` and `category` are deliberately absent.** Existing business rows
 * store the code as a loose string, so renaming it would not migrate them — it
 * would orphan every record already carrying the old value while looking like a
 * rename succeeded. Retiring a value means setting it INACTIVE and adding the
 * replacement, which leaves historical records still resolvable.
 *
 * Every field is optional, but `@IsNotEmpty` still guards `label`: sending it as
 * `""` is a request to blank the display text, not to leave it unchanged, and a
 * dropdown of empty strings is not a state worth allowing.
 */
export class UpdateMasterDataValueDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Label is required' })
  @Transform(trim)
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
