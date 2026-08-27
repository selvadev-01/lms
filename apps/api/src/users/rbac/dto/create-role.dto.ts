import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Create Role — the first step of the source-defined
 * Create Role → Assign Module Permissions → Save & Activate sequence.
 *
 * There is no `status` field. A new role is always created DRAFT, because
 * Scenario 27 requires it start out unable to grant anything, and letting the
 * caller name a status would make "Save & Activate" bypassable in one request.
 * Activation is `POST /roles/:roleId/status`, behind its own permission.
 *
 * There is no `orgId` either. Scope comes from the JWT, so a role cannot be
 * created in another tenant (Rule 8) — and `forbidNonWhitelisted` turns an
 * attempt to send one into a 400 rather than a silent no-op.
 *
 * `permissions` may be empty. The source sequence assigns them in a second step,
 * so a role legitimately exists before it grants anything; the non-empty
 * requirement belongs to activation, not creation.
 */
export class CreateRoleDto {
  /**
   * Immutable after creation. A role code is what permission grants are reasoned
   * about in audit logs and in code, so a rename would retroactively change what
   * an already-written log line refers to — the same reasoning that keeps
   * `Branch.code` out of `UpdateBranchDto`.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Role Code is required' })
  @MaxLength(100)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Role Code must be uppercase letters, digits and underscores',
  })
  code!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Role Name is required' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  description?: string;

  /**
   * Permission codes to grant. Bounded so a single request cannot be used to
   * force an unbounded write; the catalog is far smaller than this cap.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  permissions?: string[];
}
