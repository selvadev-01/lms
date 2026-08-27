import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';

import { ConfigTransferService } from './config-transfer.service';

/**
 * Module 17 — configuration import and export (Scenarios 59-62).
 *
 * Five properties carry the weight, each because its failure is silent:
 *
 * 1. **Nothing is activated when any entry is invalid.** Scenario 60. Validating
 *    while writing would leave the entries before the failure already applied,
 *    and the caller would see an error for a partially-changed system.
 * 2. **An older entry never overwrites a newer value.** Scenario 61. Without the
 *    version check an import silently discards whatever changed since the
 *    export, and nothing downstream would notice.
 * 3. **Protected settings need `settings.protected.manage`.** Rule 84. If the
 *    bulk path did not re-check, import would be a way around a permission the
 *    single-setting path enforces.
 * 4. **A masked entry is refused, not written.** An export without permission
 *    carries `value: null`; importing that would blank a real protected value.
 * 5. **An approval-gated code is refused.** Scenario 9. `SettingService` never
 *    writes one directly; if import did, it would activate a value no second
 *    administrator approved — maker-checker bypassed by the bulk path.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRANCH_A = '44444444-4444-4444-4444-444444444444';

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: '33333333-3333-3333-3333-333333333333',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['settings.export', 'settings.import', 'settings.manage'],
    ...overrides,
  };
}

interface Harness {
  service: ConfigTransferService;
  prisma: {
    setting: Record<string, jest.Mock>;
    branch: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  audit: { record: jest.Mock };
  tx: { setting: Record<string, jest.Mock> };
}

function harness(): Harness {
  const tx = {
    setting: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const prisma = {
    setting: { findFirst: jest.fn(), findMany: jest.fn() },
    branch: { findFirst: jest.fn().mockResolvedValue({ branchId: BRANCH_A }) },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new ConfigTransferService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  return { service, prisma, audit, tx };
}

/** The problems list from a rejected import, whatever shape Nest wrapped it in. */
function problemsOf(
  error: unknown,
): { settingCode: string; problem: string }[] {
  const response = (error as BadRequestException).getResponse();
  return (response as { problems?: { settingCode: string; problem: string }[] })
    .problems as { settingCode: string; problem: string }[];
}

describe('ConfigTransferService', () => {
  describe('import', () => {
    it('refuses an unsupported schema version', async () => {
      const { service } = harness();

      await expect(
        service.import(actor(), {
          schemaVersion: 9,
          settings: [{ settingCode: 'ORG_DISPLAY_NAME', value: 'x' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Scenario 46 — applying it would write another tenant's configuration into
    // this organization under the importer's own scope.
    it('refuses a document exported from another organization', async () => {
      const { service } = harness();

      await expect(
        service.import(actor(), {
          schemaVersion: 1,
          orgCode: 'OTHERORG',
          settings: [{ settingCode: 'ORG_DISPLAY_NAME', value: 'x' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown setting code', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [{ settingCode: 'MADE_UP_KEY', value: 'x' }],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].settingCode).toBe('MADE_UP_KEY');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    /**
     * Scenario 60, the property that matters most: a single bad entry must stop
     * the whole import. If this regresses, a caller sees an error for a system
     * that has already been half-changed.
     */
    it('applies nothing when one entry among several is invalid', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [
            { settingCode: 'ORG_DISPLAY_NAME', value: 'Perfectly Valid' },
            { settingCode: 'MADE_UP_KEY', value: 'x' },
          ],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)).toHaveLength(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // Scenario 61 — without this the import silently discards whatever changed
    // between the export and the import.
    it('refuses an entry older than the stored value', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue({
        settingId: 'aaaa',
        version: 7,
        valueJson: 'Current',
      });

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [
            { settingCode: 'ORG_DISPLAY_NAME', value: 'Stale', version: 2 },
          ],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].problem).toMatch(/newer value/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts an entry at the same version as the stored value', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue({
        settingId: 'aaaa',
        version: 7,
        valueJson: 'Current',
      });

      const result = await service.import(actor(), {
        schemaVersion: 1,
        settings: [
          { settingCode: 'ORG_DISPLAY_NAME', value: 'Newer', version: 7 },
        ],
      });

      expect(result.updated).toBe(1);
    });

    // Rule 84 — import must not become a way around the protected-setting
    // permission the single-setting path enforces.
    it('refuses a protected setting without settings.protected.manage', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [{ settingCode: 'AUDIT_EXPORT_MAX_DAYS', value: 90 }],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].problem).toMatch(/protected/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    /**
     * Scenario 9 — `SettingService` never writes an approval-gated code, and
     * import must not be the way around that. Writing it here would activate a
     * value no second administrator approved.
     */
    it('refuses a code that requires maker-checker approval', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const error = await service
        .import(
          actor({
            permissions: [
              'settings.import',
              'settings.protected.manage', // so the protected check cannot be
            ], //                            what refuses this entry
          }),
          {
            schemaVersion: 1,
            settings: [{ settingCode: 'AUDIT_EXPORT_MAX_DAYS', value: 90 }],
          },
        )
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].problem).toMatch(/approval/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an entry whose value was masked on export', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [
            {
              settingCode: 'ORG_DISPLAY_NAME',
              value: null,
              isValueMasked: true,
            },
          ],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].problem).toMatch(/protected/i);
    });

    it('refuses the same code twice in one document', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [
            { settingCode: 'ORG_DISPLAY_NAME', value: 'One' },
            { settingCode: 'ORG_DISPLAY_NAME', value: 'Two' },
          ],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].problem).toMatch(/more than once/i);
    });

    // Rule 83, referential integrity. Left to the foreign key this would be an
    // opaque 503 raised AFTER earlier entries had been written.
    it('refuses a branch that does not exist in this organization', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);
      prisma.branch.findFirst.mockResolvedValue(null);

      const error = await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [
            {
              settingCode: 'EOD_AUTO_RUN_ENABLED',
              branchId: BRANCH_A,
              value: true,
            },
          ],
        })
        .catch((e: unknown) => e);

      expect(problemsOf(error)[0].problem).toMatch(/does not exist/i);
    });

    it('writes nothing on a dry run but reports what would happen', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      const result = await service.import(actor(), {
        schemaVersion: 1,
        dryRun: true,
        settings: [{ settingCode: 'ORG_DISPLAY_NAME', value: 'Planned' }],
      });

      expect(result).toMatchObject({ dryRun: true, applied: 0, created: 1 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not rewrite a value that already matches', async () => {
      const { service, prisma, tx } = harness();
      prisma.setting.findFirst.mockResolvedValue({
        settingId: 'aaaa',
        version: 3,
        valueJson: 'Same',
      });

      const result = await service.import(actor(), {
        schemaVersion: 1,
        settings: [{ settingCode: 'ORG_DISPLAY_NAME', value: 'Same' }],
      });

      expect(result.unchanged).toBe(1);
      expect(tx.setting.updateMany).not.toHaveBeenCalled();
    });

    it('audits a rejected import', async () => {
      const { service, prisma, audit } = harness();
      prisma.setting.findFirst.mockResolvedValue(null);

      await service
        .import(actor(), {
          schemaVersion: 1,
          settings: [{ settingCode: 'MADE_UP_KEY', value: 'x' }],
        })
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONFIGURATION_IMPORT_REJECTED' }),
      );
    });
  });

  describe('export', () => {
    it('masks a protected value the caller may not read', async () => {
      const { service, prisma } = harness();
      prisma.setting.findMany.mockResolvedValue([
        {
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          branchId: null,
          valueJson: 90,
          version: 2,
        },
      ]);

      const doc = await service.export(actor());

      expect(doc.settings[0].isValueMasked).toBe(true);
      expect(doc.settings[0].value).toBeNull();
    });

    it('includes a protected value for a caller who may read it', async () => {
      const { service, prisma } = harness();
      prisma.setting.findMany.mockResolvedValue([
        {
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          branchId: null,
          valueJson: 90,
          version: 2,
        },
      ]);

      const doc = await service.export(
        actor({
          permissions: ['settings.export', 'settings.protected.manage'],
        }),
      );

      expect(doc.settings[0].isValueMasked).toBe(false);
      expect(doc.settings[0].value).toBe(90);
    });

    it('confines a branch caller to their own branch and the org defaults', async () => {
      const { service, prisma } = harness();
      prisma.setting.findMany.mockResolvedValue([]);

      await service.export(actor({ branchId: BRANCH_A }));

      const call = prisma.setting.findMany.mock.calls[0] as [
        { where: { OR?: { branchId: string | null }[] } },
      ];
      expect(call[0].where.OR).toEqual([
        { branchId: BRANCH_A },
        { branchId: null },
      ]);
    });

    // Exported, not omitted: a document missing them would misdescribe the
    // configuration. The flag is how the operator learns it cannot be imported.
    it('exports an approval-gated setting and flags it', async () => {
      const { service, prisma } = harness();
      prisma.setting.findMany.mockResolvedValue([
        {
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          branchId: null,
          valueJson: 90,
          version: 1,
        },
      ]);

      const doc = await service.export(
        actor({
          permissions: ['settings.export', 'settings.protected.manage'],
        }),
      );

      expect(doc.settings[0].requiresApproval).toBe(true);
      expect(doc.settings[0].value).toBe(90);
    });

    it('audits the export', async () => {
      const { service, prisma, audit } = harness();
      prisma.setting.findMany.mockResolvedValue([]);

      await service.export(actor());

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONFIGURATION_EXPORTED' }),
      );
    });
  });
});
