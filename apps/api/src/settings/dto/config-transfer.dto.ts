import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';

/**
 * Configuration import DTOs (Scenarios 59-62).
 *
 * Structural validation only. Whether a VALUE is legal for its code is decided
 * by the registry inside `ConfigTransferService`, because that answer depends on
 * the code and the registry is the only thing that knows — the same reasoning
 * that keeps `value` unparsed in the settings action.
 *
 * The global pipe runs `whitelist` and `forbidNonWhitelisted`, so a property
 * with no decorator is stripped and then rejected. `@Allow()` on `value` is
 * therefore load-bearing: without it, every entry's value would be dropped
 * before the service ever saw it.
 */

/**
 * A generous ceiling rather than a tuning parameter. The registry is small, so a
 * document far larger than this is malformed or hostile, not a big import.
 */
const MAX_ENTRIES = 500;

export class ImportSettingEntryDto {
  @IsString()
  @Transform(trim)
  settingCode!: string;

  /** Null or absent = organization scope. */
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  /** Validated against the registry schema for `settingCode`, not here. */
  @Allow()
  value?: unknown;

  /**
   * The version this entry was exported at.
   *
   * Optional, and its absence is not neutral: an entry that cannot say which
   * value it was based on cannot prove it is not older than the server's
   * (Scenario 61).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /**
   * Set by the exporter when the value was withheld. Carried so the import can
   * refuse it by name rather than writing null over a real protected value.
   */
  @IsOptional()
  @IsBoolean()
  isValueMasked?: boolean;
}

export class ImportConfigurationDto {
  @IsInt()
  schemaVersion!: number;

  /**
   * The organization the document came from.
   *
   * Optional so a hand-written document is usable, but checked when present:
   * importing another tenant's configuration would write their settings into
   * this organization under the importer's scope (Scenario 46).
   */
  @IsOptional()
  @IsString()
  @Transform(trim)
  orgCode?: string;

  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => ImportSettingEntryDto)
  settings!: ImportSettingEntryDto[];

  /**
   * Validate and report without writing.
   *
   * The validation is identical to a real import — a rehearsal that checked
   * less would not tell the operator what they need to know.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  dryRun?: boolean;
}
