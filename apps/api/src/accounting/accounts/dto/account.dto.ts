import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Chart-of-accounts request shapes.
 *
 * **These, not the zod schemas, are what guard the API.** The schemas in
 * `packages/validation` run in the browser; a rule written only there is
 * enforced only there. The two are deliberately kept in step, and the database
 * triggers are what guarantee the invariants underneath both.
 *
 * Three fields are absent from every DTO here, and their absence is the point:
 *
 * - **`orgId`** — the organization comes from the JWT. A client-supplied one
 *   would be a cross-tenant write.
 * - **`branchId`** — accounts are organization-wide by design; which branch a
 *   posting belongs to is carried by the journal entry, not by owning a
 *   separate account per branch.
 * - **`accountId`** — identity is the server's to mint.
 *
 * With the global `forbidNonWhitelisted`, sending any of them is a 400 rather
 * than a silently ignored field.
 */

const ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
] as const;

const NORMAL_BALANCES = ['DEBIT', 'CREDIT'] as const;

const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

const BRANCH_SCOPES = ['ORGANIZATION', 'BRANCH'] as const;

/**
 * Coerces a query-string boolean.
 *
 * A bare `transform: true` would make the string `"false"` truthy, which is the
 * failure mode this exists to avoid: a filter the caller switched off would
 * silently stay on.
 */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class CreateAccountDto {
  @IsString({ message: 'Account Code is required' })
  @IsNotEmpty({ message: 'Account Code is required' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'Account Code may use letters, digits, dot, underscore and hyphen',
  })
  @MaxLength(50, { message: 'Account Code is too long' })
  accountCode!: string;

  @IsString({ message: 'Account Name is required' })
  @IsNotEmpty({ message: 'Account Name is required' })
  @Transform(trim)
  @MaxLength(200, { message: 'Account Name is too long' })
  accountName!: string;

  @IsIn([...ACCOUNT_TYPES], { message: 'Account Type is required' })
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @IsIn([...NORMAL_BALANCES], { message: 'Normal Balance is required' })
  normalBalance!: (typeof NORMAL_BALANCES)[number];

  @IsIn([...ACCOUNT_STATUSES], { message: 'Status is required' })
  status!: (typeof ACCOUNT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  accountCategory?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Parent Account is not a valid account' })
  parentAccountId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isManualPostingAllowed?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isControlAccount?: boolean;

  @IsOptional()
  @IsIn([...BRANCH_SCOPES])
  branchScope?: (typeof BRANCH_SCOPES)[number];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Effective From must be a valid date',
  })
  effectiveFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Effective To must be a valid date',
  })
  effectiveTo?: string;
}

/**
 * Account edit.
 *
 * `accountCode`, `accountType` and `normalBalance` are present rather than
 * omitted, because whether they may change depends on data the client does not
 * hold: an account with posted lines has its identity frozen and one without
 * does not. The service decides and answers 409. Omitting them here would
 * instead make an attempt to change them a silent no-op.
 *
 * Written out rather than derived with `PartialType(CreateAccountDto)` for the
 * same reason the rest of the codebase writes its update DTOs out: a mapped
 * type would silently acquire any field later added to create, including one
 * that must never be editable.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Account Code is required' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'Account Code may use letters, digits, dot, underscore and hyphen',
  })
  @MaxLength(50, { message: 'Account Code is too long' })
  accountCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Account Name is required' })
  @Transform(trim)
  @MaxLength(200, { message: 'Account Name is too long' })
  accountName?: string;

  @IsOptional()
  @IsIn([...ACCOUNT_TYPES], { message: 'Account Type is required' })
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @IsOptional()
  @IsIn([...NORMAL_BALANCES], { message: 'Normal Balance is required' })
  normalBalance?: (typeof NORMAL_BALANCES)[number];

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  accountCategory?: string;

  /**
   * Accepts `null` to clear the parent, which is why it is not `@IsUUID()`
   * alone: detaching an account from its parent is a legitimate edit, and a
   * schema that only accepted a uuid would make it impossible to express.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Parent Account is not a valid account' })
  parentAccountId?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isManualPostingAllowed?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isControlAccount?: boolean;

  @IsOptional()
  @IsIn([...BRANCH_SCOPES])
  branchScope?: (typeof BRANCH_SCOPES)[number];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Effective From must be a valid date',
  })
  effectiveFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Effective To must be a valid date',
  })
  effectiveTo?: string;

  /**
   * The optimistic-concurrency token: the record's ISO `updatedAt`.
   *
   * Required, not optional. An edit submitted without one cannot be checked for
   * staleness, and accepting it would let the last writer win silently
   * (Scenario 49).
   */
  @IsString({ message: 'This form is out of date. Reload and try again.' })
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class DeactivateAccountDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  reason?: string;

  @IsString({ message: 'This form is out of date. Reload and try again.' })
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class ActivateAccountDto {
  @IsString({ message: 'This form is out of date. Reload and try again.' })
  @IsNotEmpty({ message: 'This form is out of date. Reload and try again.' })
  expectedVersion!: string;
}

export class ListAccountsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn([...ACCOUNT_TYPES])
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @IsOptional()
  @IsIn([...ACCOUNT_STATUSES])
  status?: (typeof ACCOUNT_STATUSES)[number];

  /** Narrow to accounts a journal line may reference at all. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  postableOnly?: boolean;

  /**
   * Narrow to accounts a *hand-authored* journal may reference.
   *
   * Strictly narrower than `postableOnly`: the manual journal builder's account
   * picker uses this one, so a control account never appears in it.
   */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  manualPostableOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
