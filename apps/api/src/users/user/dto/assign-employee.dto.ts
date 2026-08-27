import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Move an employee to another branch — Scenarios 17, 18, 19, 50, 60.
 *
 * The reason is captured because Scenario 50 requires the audit record show the
 * old and new context, and a branch id alone does not say why someone moved.
 *
 * Note what this does NOT do: historical collections, assignments and ledger
 * lines keep the branch they were recorded under (Rule 50). This writes one
 * column on one row; nothing downstream is rewritten, which is precisely why
 * the audit record has to carry the old value.
 */
export class AssignEmployeeDto {
  @IsUUID('4', { message: 'Branch is required' })
  branchId!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;
}
