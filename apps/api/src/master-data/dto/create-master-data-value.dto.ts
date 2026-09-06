import { MASTER_DATA_CATEGORIES } from '@lms/validation';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Add one value to an option list.
 *
 * `isSystem` is deliberately absent. It marks rows the seed owns and business
 * logic reads by code, and a caller who could set it could make a row
 * undeletable at will. The service hardcodes it to `false`; `forbidNonWhitelisted`
 * turns an attempt to send it into a 400.
 *
 * Decorator order matters on the required fields: the emptiness check runs
 * before the length and pattern checks, so a blank submission reports "X is
 * required" rather than complaining about the format of an empty string.
 */
export class CreateMasterDataValueDto {
  @IsIn([...MASTER_DATA_CATEGORIES], { message: 'Unknown option list' })
  category!: (typeof MASTER_DATA_CATEGORIES)[number];

  /**
   * The stored value. Constrained to the same shape as the other codes in this
   * system — uppercase, digits and underscores — because it is written into
   * business columns and compared against literals in code, where a value with
   * a space or a lowercase letter is a bug waiting to happen.
   */
  @IsString({ message: 'Code is required' })
  @IsNotEmpty({ message: 'Code is required' })
  @Transform(trim)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Code must be uppercase letters, digits and underscores',
  })
  @MaxLength(50)
  code!: string;

  @IsString({ message: 'Label is required' })
  @IsNotEmpty({ message: 'Label is required' })
  @Transform(trim)
  @MaxLength(200)
  label!: string;

  /** Bounded so ordering stays a small hand-set number, not an arbitrary int. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /**
   * LOAN_TYPE only: must an application of this type carry a COLLATERAL
   * document before it can be submitted?
   *
   * This is what replaced the hardcoded `COLLATERAL_LOAN_TYPES` set naming GOLD
   * and VEHICLE — once tenants define their own loan types, only the row itself
   * can answer. The service refuses it for any other category rather than
   * storing an answer to a question that category does not ask.
   */
  @IsOptional()
  @IsBoolean()
  requiresCollateral?: boolean;
}
