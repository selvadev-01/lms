import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { getSettingDefinition, validateSettingValue } from '@lms/validation';

import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';

import type { ImportConfigurationDto } from './dto/config-transfer.dto';

export const SETTINGS_EXPORT_PERMISSION = 'settings.export';
export const SETTINGS_IMPORT_PERMISSION = 'settings.import';
const SETTINGS_PROTECTED_MANAGE_PERMISSION = 'settings.protected.manage';

/**
 * Configuration import and export (Scenarios 59-62).
 *
 * # Validate everything, then activate — never interleave
 *
 * Rule 83 requires schema, scope and referential integrity to be checked
 * *before* activation, and Scenario 60 requires that no partial invalid
 * configuration becomes active. Those are the same requirement seen from two
 * sides, and both are met by the two-pass shape below: every entry is validated
 * into a plan, and only a wholly valid plan is written — inside one transaction,
 * so a failure part-way cannot leave half an import applied.
 *
 * Validating as we write would satisfy neither: the tenth entry failing would
 * leave nine already active.
 *
 * # An older version is a conflict, not an overwrite
 *
 * Scenario 61. Each entry may carry the `version` it was exported at. If the
 * server's row has moved on since, the import is refused rather than silently
 * clobbering a newer value. An entry with no version is treated as "create
 * only" for the same reason — it cannot prove it knew about the current value.
 *
 * # Protected settings need their own authority
 *
 * Rule 84. `settings.import` alone does not carry protected settings; the
 * payload is refused naming them unless the caller also holds
 * `settings.protected.manage`. Import must not become a way around a permission
 * the single-setting path enforces.
 *
 * # An approval-gated code is refused outright
 *
 * `SettingService` never writes a code whose definition requires approval — it
 * returns a change request and leaves the active row untouched (Scenario 9).
 * Import honours the same invariant by REFUSING those entries: writing them
 * would activate a value no second administrator approved, and silently
 * converting them to change requests would report an import that did not take
 * effect. They are still exported, so the document describes the real
 * configuration; the entry carries `requiresApproval` to say why it cannot come
 * back in this way.
 */

/** What a caller may not know without being told which entry was at fault. */
export interface ImportEntryProblem {
  settingCode: string;
  problem: string;
}

export interface ImportResult {
  /** Entries written. Empty when `dryRun` was requested. */
  applied: number;
  created: number;
  updated: number;
  /** Non-fatal: entries whose value already matched, so nothing was written. */
  unchanged: number;
  dryRun: boolean;
}

export interface ExportedSetting {
  settingCode: string;
  branchId: string | null;
  value: unknown;
  version: number;
  /** True when the value is masked because the caller may not read it. */
  isValueMasked: boolean;
  /** Import refuses these: they must go through maker-checker (Scenario 9). */
  requiresApproval: boolean;
}

export interface ConfigurationExport {
  orgCode: string;
  exportedAt: string;
  /** Bumped only for a breaking change to this document's shape. */
  schemaVersion: 1;
  settings: ExportedSetting[];
}

interface PlannedWrite {
  settingCode: string;
  branchId: string | null;
  value: unknown;
  existingId: string | null;
  existingVersion: number | null;
  isProtected: boolean;
  unchanged: boolean;
}

@Injectable()
export class ConfigTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Export the caller's configuration (Rule 56).
   *
   * A protected value the caller cannot read is masked here exactly as it is on
   * the settings screen. Exporting the real value would make the export a way
   * around the masking — the same reasoning that keeps audit export restricted
   * to what the UI would show.
   */
  async export(actor: AuthContext): Promise<ConfigurationExport> {
    const canReadProtected = actor.permissions.includes(
      SETTINGS_PROTECTED_MANAGE_PERMISSION,
    );

    const rows = await this.prisma.setting.findMany({
      where: {
        orgId: actor.orgId,
        status: 'ACTIVE',
        // A branch-confined caller exports their own branch and the
        // organization defaults, matching what `SettingService.list` shows
        // them. Never another branch's overrides.
        ...(actor.branchId
          ? { OR: [{ branchId: actor.branchId }, { branchId: null }] }
          : {}),
      },
      orderBy: [{ settingCode: 'asc' }],
    });

    const settings = rows.map((row) => {
      const definition = getSettingDefinition(row.settingCode);
      const masked = (definition?.isProtected ?? false) && !canReadProtected;

      return {
        settingCode: row.settingCode,
        branchId: row.branchId,
        value: masked ? null : row.valueJson,
        version: row.version,
        isValueMasked: masked,
        // Kept in the document — an export that omitted them would misdescribe
        // the configuration — but flagged, because import refuses them: an
        // approval-gated value must go through maker-checker (Scenario 9).
        requiresApproval: definition?.requiresApproval ?? false,
      };
    });

    await this.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: 'CONFIGURATION_EXPORTED',
      entityType: 'SETTING',
      metadata: { count: settings.length, maskedProtected: !canReadProtected },
    });

    return {
      orgCode: actor.orgCode,
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      settings,
    };
  }

  /**
   * Import a configuration document (Scenarios 59-62).
   *
   * `dryRun` validates and reports without writing, so an operator can see what
   * an import would do before committing to it. The validation is identical —
   * a dry run that checked less would be worthless as a rehearsal.
   */
  async import(
    actor: AuthContext,
    dto: ImportConfigurationDto,
  ): Promise<ImportResult> {
    if (dto.schemaVersion !== 1) {
      throw new BadRequestException(
        `Unsupported configuration schema version ${dto.schemaVersion}. This system reads version 1.`,
      );
    }

    // Scenario 46 — a document exported from another organization is refused
    // outright. Applying it would write another tenant's configuration into
    // this one under the importer's own scope.
    if (dto.orgCode && dto.orgCode !== actor.orgCode) {
      throw new BadRequestException(
        `This configuration was exported from organization ${dto.orgCode} and cannot be imported into ${actor.orgCode}.`,
      );
    }

    if (dto.settings.length === 0) {
      throw new BadRequestException(
        'The configuration contains no settings to import.',
      );
    }

    const problems: ImportEntryProblem[] = [];
    const plan: PlannedWrite[] = [];
    const seen = new Set<string>();

    for (const entry of dto.settings) {
      const scopeKey = `${entry.settingCode}::${entry.branchId ?? 'ORG'}`;
      if (seen.has(scopeKey)) {
        problems.push({
          settingCode: entry.settingCode,
          problem: 'Listed more than once for the same scope',
        });
        continue;
      }
      seen.add(scopeKey);

      // A masked entry carries no value to write. Importing it as null would
      // overwrite a real protected value with nothing.
      if (entry.isValueMasked) {
        problems.push({
          settingCode: entry.settingCode,
          problem:
            'Exported without its value because it is protected. Re-export it with permission to read protected settings, or remove it from the document.',
        });
        continue;
      }

      const definition = getSettingDefinition(entry.settingCode);
      if (!definition) {
        problems.push({
          settingCode: entry.settingCode,
          problem: 'Not a setting this system supports',
        });
        continue;
      }

      // Rule 84 — the bulk path must not carry a permission the single-setting
      // path enforces.
      if (
        definition.isProtected &&
        !actor.permissions.includes(SETTINGS_PROTECTED_MANAGE_PERMISSION)
      ) {
        problems.push({
          settingCode: entry.settingCode,
          problem:
            'Protected setting — importing it needs permission to manage protected settings',
        });
        continue;
      }

      // An approval-gated code is NEVER written directly — `SettingService`
      // returns a change request and leaves the active row untouched, which is
      // Scenario 9. Writing it here would activate a value no second
      // administrator approved, making import a way around maker-checker
      // entirely. Refused rather than silently converted to a change request:
      // an import that reported success while the value stayed inactive would
      // misdescribe what happened just as badly.
      if (definition.requiresApproval) {
        problems.push({
          settingCode: entry.settingCode,
          problem:
            'Requires maker-checker approval and cannot be imported. Change it on the settings screen so a second administrator can approve it.',
        });
        continue;
      }

      const scopeProblem = this.checkScope(actor, definition.scope, entry);
      if (scopeProblem) {
        problems.push({
          settingCode: entry.settingCode,
          problem: scopeProblem,
        });
        continue;
      }

      // Referential integrity (Rule 83): the branch must exist in THIS
      // organization. Left to the foreign key, a stale branch id would surface
      // as an opaque 503 from the write rather than a named entry here — and it
      // would do so after other entries had already been applied.
      if (entry.branchId) {
        const branch = await this.prisma.branch.findFirst({
          where: { orgId: actor.orgId, branchId: entry.branchId },
          select: { branchId: true },
        });
        if (!branch) {
          problems.push({
            settingCode: entry.settingCode,
            problem: 'Names a branch that does not exist in this organization',
          });
          continue;
        }
      }

      const validated = validateSettingValue(entry.settingCode, entry.value);
      if (!validated.ok) {
        problems.push({
          settingCode: entry.settingCode,
          problem: validated.message,
        });
        continue;
      }

      const existing = await this.prisma.setting.findFirst({
        where: {
          orgId: actor.orgId,
          settingCode: entry.settingCode,
          branchId: entry.branchId ?? null,
        },
      });

      // Scenario 61 — the import knew about an older value than the one now
      // stored, so applying it would discard a change made since the export.
      if (
        existing &&
        entry.version !== undefined &&
        entry.version < existing.version
      ) {
        problems.push({
          settingCode: entry.settingCode,
          problem: `The server has a newer value (version ${existing.version}; this document carries ${entry.version}). Re-export before importing.`,
        });
        continue;
      }

      plan.push({
        settingCode: entry.settingCode,
        branchId: entry.branchId ?? null,
        value: validated.value,
        existingId: existing?.settingId ?? null,
        existingVersion: existing?.version ?? null,
        isProtected: definition.isProtected,
        unchanged:
          existing !== null &&
          JSON.stringify(existing.valueJson) ===
            JSON.stringify(validated.value),
      });
    }

    // Scenario 60 — nothing is activated when any entry is invalid. Reported as
    // a list rather than the first failure, so one round trip tells the operator
    // everything they have to fix.
    if (problems.length > 0) {
      await this.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: 'CONFIGURATION_IMPORT_REJECTED',
        entityType: 'SETTING',
        metadata: { problems, entries: dto.settings.length },
      });

      throw new BadRequestException({
        message: `This configuration was not imported: ${problems.length} of ${dto.settings.length} entries cannot be applied. No setting was changed.`,
        problems,
      });
    }

    const writes = plan.filter((p) => !p.unchanged);
    const unchanged = plan.length - writes.length;

    if (dto.dryRun) {
      return {
        applied: 0,
        created: writes.filter((w) => w.existingId === null).length,
        updated: writes.filter((w) => w.existingId !== null).length,
        unchanged,
        dryRun: true,
      };
    }

    // One transaction: a failure part-way must not leave half an import active
    // (Scenario 60). The conditional `updateMany` inside also means a row that
    // moved between validation and write fails rather than being clobbered.
    await this.prisma.$transaction(async (tx) => {
      for (const write of writes) {
        if (write.existingId) {
          const result = await tx.setting.updateMany({
            where: {
              orgId: actor.orgId,
              settingId: write.existingId,
              version: write.existingVersion as number,
            },
            data: {
              valueJson: write.value as never,
              version: { increment: 1 },
              updatedBy: actor.userId,
            },
          });

          if (result.count === 0) {
            throw new ConflictException(
              `"${write.settingCode}" changed while this import was being applied. Nothing was imported; re-export and try again.`,
            );
          }
        } else {
          const definition = getSettingDefinition(write.settingCode)!;
          await tx.setting.create({
            data: {
              orgId: actor.orgId,
              branchId: write.branchId,
              settingCode: write.settingCode,
              settingCategory: definition.category,
              valueType: definition.valueType,
              valueJson: write.value as never,
              isProtected: definition.isProtected,
              createdBy: actor.userId,
              updatedBy: actor.userId,
            },
          });
        }
      }
    });

    await this.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: 'CONFIGURATION_IMPORTED',
      entityType: 'SETTING',
      metadata: {
        created: writes.filter((w) => w.existingId === null).length,
        updated: writes.filter((w) => w.existingId !== null).length,
        unchanged,
        codes: writes.map((w) => w.settingCode),
      },
    });

    return {
      applied: writes.length,
      created: writes.filter((w) => w.existingId === null).length,
      updated: writes.filter((w) => w.existingId !== null).length,
      unchanged,
      dryRun: false,
    };
  }

  /**
   * Referential integrity of the scope (Rule 83).
   *
   * Returns a problem string, or null when the entry is in scope. A branch entry
   * from a caller confined to another branch is refused here rather than at
   * write time, so it joins the reported list instead of aborting the pass.
   */
  private checkScope(
    actor: AuthContext,
    scope: string,
    entry: { settingCode: string; branchId?: string | null },
  ): string | null {
    const branchId = entry.branchId ?? null;

    if (scope === 'ORG' && branchId !== null) {
      return 'This setting is organization-wide and cannot carry a branch';
    }
    if (scope === 'BRANCH' && branchId === null) {
      return 'This setting is branch-scoped and needs a branch';
    }
    if (actor.branchId && branchId !== null && branchId !== actor.branchId) {
      return 'Another branch — outside the scope you may write';
    }
    return null;
  }
}
