import { MASTER_DATA_CATEGORIES } from '@lms/validation';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * Which option list to read.
 *
 * `category` is required and constrained to the known set, so a caller cannot
 * probe for arbitrary category strings or receive an empty list that reads as
 * "no values configured" when the real answer is "no such list".
 *
 * The allowed values come from `@lms/validation` rather than being retyped here,
 * so the API, the web forms and the seed cannot disagree about what categories
 * exist.
 */
export class ListMasterDataDto {
  @IsIn([...MASTER_DATA_CATEGORIES], { message: 'Unknown option list' })
  category!: (typeof MASTER_DATA_CATEGORIES)[number];

  /**
   * Explicit `=== 'true'` rather than relying on `transform`, which would make
   * the string `"false"` truthy — the same trap `ListBranchesDto` documents.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}
