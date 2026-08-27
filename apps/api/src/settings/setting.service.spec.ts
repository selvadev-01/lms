import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { SettingService } from './setting.service';

/**
 * Module 17 — settings.
 *
 * Five properties carry the weight here, each because its failure is silent:
 *
 * 1. **The registry, not the table, decides what exists.** An unknown code must
 *    be refused before anything else is considered. If this check ever passes,
 *    `settings` quietly becomes the arbitrary key/value store Rules 8 and 9
 *    forbid, and nothing downstream would notice.
 * 2. **A stale version loses.** The update is a conditional `updateMany`;
 *    `count === 0` is the conflict. A read-compare-write would let two callers
 *    both observe version 3 and both proceed (Scenario 7).
 * 3. **Approval-gated codes never write the row.** Scenario 9 requires the
 *    active configuration to stay effective until approval — so `upsert` must
 *    return a change request and leave `settings` untouched.
 * 4. **Protected settings check the DEFINITION, not the row.** Reading the
 *    column would let whoever can write the row write their own permission
 *    check (Rule 43, Scenario 64).
 * 5. **Scope narrows, never widens** (Scenario 44).
 *
 * Real constraints and the partial unique indexes are covered by the migration
 * verification and by e2e; this file covers the decisions the service makes.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_A = '44444444-4444-4444-4444-444444444444';
const BRANCH_B = '55555555-5555-5555-5555-555555555555';
const SETTING_ID = '66666666-6666-6666-6666-666666666666';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

/** A caller with organization-wide reach and the full settings surface. */
function superAdmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: [
      'settings.view',
      'settings.manage',
      'settings.branch.manage',
      'settings.protected.manage',
    ],
    ...overrides,
  };
}

/** Branch A, holding only the branch-scoped write. */
function branchAdmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return superAdmin({
    branchId: BRANCH_A,
    roles: ['BRANCH_ADMIN'],
    permissions: ['settings.view', 'settings.branch.manage'],
    ...overrides,
  });
}

function settingRow(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    settingId: SETTING_ID,
    branchId: null,
    settingCode: 'ORG_DISPLAY_NAME',
    settingCategory: 'GENERAL',
    valueType: 'STRING',
    valueJson: 'Acme Finance',
    effectiveFrom: null,
    effectiveTo: null,
    status: 'ACTIVE',
    version: 3,
    isProtected: false,
    createdBy: USER_ID,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedBy: USER_ID,
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  service: SettingService;
  prisma: {
    setting: Record<string, jest.Mock>;
    settingChangeRequest: Record<string, jest.Mock>;
  };
  audit: { record: jest.Mock };
}

function harness(): Harness {
  const prisma = {
    setting: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(settingRow({ version: 4 })),
      create: jest.fn().mockResolvedValue(settingRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue(settingRow()),
    },
    settingChangeRequest: {
      create: jest.fn().mockResolvedValue({
        changeRequestId: 'cr-1',
        changeRequestNumber: 'CHG-000001',
        baseVersion: 0,
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new SettingService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  return { service, prisma, audit };
}

describe('SettingService', () => {
  describe('the registry decides what may be written', () => {
    it('refuses a code that is not defined, without touching the table', async () => {
      const { service, prisma } = harness();

      await expect(
        service.upsert(
          superAdmin(),
          { settingCode: 'ARBITRARY_KEY', value: 'x', changeReason: 'r' },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.setting.create).not.toHaveBeenCalled();
      expect(prisma.setting.updateMany).not.toHaveBeenCalled();
    });

    it('audits the refusal so Scenario 68 has evidence', async () => {
      const { service, audit } = harness();

      await service
        .upsert(
          superAdmin(),
          { settingCode: 'ARBITRARY_KEY', value: 'x', changeReason: 'r' },
          META,
        )
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SETTING_REJECTED }),
      );
    });

    it('rejects a value the definition refuses, leaving the row unchanged', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow());

      await expect(
        service.upsert(
          superAdmin(),
          { settingCode: 'ORG_DISPLAY_NAME', value: '   ', changeReason: 'r' },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.setting.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a floating-point money value rather than truncating it', async () => {
      const { service, prisma } = harness();

      await expect(
        service.upsert(
          superAdmin(),
          {
            settingCode: 'BRANCH_CASH_LIMIT_PAISE',
            branchId: BRANCH_A,
            value: '1000.50',
            changeReason: 'r',
          },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.setting.create).not.toHaveBeenCalled();
      expect(prisma.settingChangeRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('optimistic locking (Scenario 7)', () => {
    it('rejects a stale version and does not overwrite', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow({ version: 5 }));
      // Nobody matched version 3 — someone else already moved it.
      prisma.setting.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.upsert(
          superAdmin(),
          {
            settingCode: 'ORG_DISPLAY_NAME',
            value: 'New name',
            changeReason: 'r',
            expectedVersion: 3,
          },
          META,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('audits the concurrency conflict with both versions', async () => {
      const { service, prisma, audit } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow({ version: 5 }));
      prisma.setting.updateMany.mockResolvedValue({ count: 0 });

      await service
        .upsert(
          superAdmin(),
          {
            settingCode: 'ORG_DISPLAY_NAME',
            value: 'New name',
            changeReason: 'r',
            expectedVersion: 3,
          },
          META,
        )
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SETTING_CONCURRENT_EDIT_REJECTED,
          metadata: expect.objectContaining({ expected: 3, actual: 5 }),
        }),
      );
    });

    it('compares the version in the same statement as the write', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow());

      await service.upsert(
        superAdmin(),
        {
          settingCode: 'ORG_DISPLAY_NAME',
          value: 'New name',
          changeReason: 'r',
          expectedVersion: 3,
        },
        META,
      );

      // The version is part of the WHERE, not checked beforehand in JS.
      expect(prisma.setting.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: 3, orgId: ORG_ID }),
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
    });

    it('requires a version when updating an existing row', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow());

      await expect(
        service.upsert(
          superAdmin(),
          { settingCode: 'ORG_DISPLAY_NAME', value: 'x', changeReason: 'r' },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('maker-checker (Scenario 9)', () => {
    it('raises a change request and leaves the active setting untouched', async () => {
      const { service, prisma } = harness();

      const result = await service.upsert(
        superAdmin(),
        {
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          value: '90',
          changeReason: 'Tighten export window',
        },
        META,
      );

      expect(result.changeRequestId).toBe('cr-1');
      expect(result.setting).toBeUndefined();
      // The whole point: the live configuration did not move.
      expect(prisma.setting.create).not.toHaveBeenCalled();
      expect(prisma.setting.updateMany).not.toHaveBeenCalled();
      expect(prisma.settingChangeRequest.create).toHaveBeenCalled();
    });

    it('writes a direct change for a code that does not require approval', async () => {
      const { service, prisma } = harness();

      const result = await service.upsert(
        superAdmin(),
        { settingCode: 'ORG_DISPLAY_NAME', value: 'Acme', changeReason: 'r' },
        META,
      );

      expect(result.setting).toBeDefined();
      expect(prisma.settingChangeRequest.create).not.toHaveBeenCalled();
      expect(prisma.setting.create).toHaveBeenCalled();
    });
  });

  describe('protected settings (Scenario 64)', () => {
    it('refuses a caller without settings.protected.manage', async () => {
      const { service, prisma } = harness();
      const actor = superAdmin({
        permissions: ['settings.view', 'settings.manage'],
      });

      await expect(
        service.upsert(
          actor,
          {
            settingCode: 'AUDIT_EXPORT_MAX_DAYS',
            value: '90',
            changeReason: 'r',
          },
          META,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.settingChangeRequest.create).not.toHaveBeenCalled();
    });

    it('masks the value on read for a caller without the permission', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(
        settingRow({
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          valueJson: 90,
          isProtected: true,
        }),
      );

      const detail = await service.get(
        superAdmin({ permissions: ['settings.view'] }),
        SETTING_ID,
      );

      expect(detail.isValueMasked).toBe(true);
      expect(detail.value).not.toBe(90);
    });

    it('shows the value to a caller who holds it', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(
        settingRow({
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          valueJson: 90,
          isProtected: true,
        }),
      );

      const detail = await service.get(superAdmin(), SETTING_ID);

      expect(detail.isValueMasked).toBe(false);
      expect(detail.value).toBe(90);
    });

    it('masks from the registry even when the row snapshot disagrees', async () => {
      const { service, prisma } = harness();
      // The row claims unprotected; the registry says otherwise. The registry
      // wins, or a stale snapshot would leak a protected value.
      prisma.setting.findFirst.mockResolvedValue(
        settingRow({
          settingCode: 'AUDIT_EXPORT_MAX_DAYS',
          valueJson: 90,
          isProtected: false,
        }),
      );

      const detail = await service.get(
        superAdmin({ permissions: ['settings.view'] }),
        SETTING_ID,
      );

      expect(detail.isValueMasked).toBe(true);
    });
  });

  describe('scope (Scenarios 3, 44, 46)', () => {
    it('refuses a branch admin writing another branch', async () => {
      const { service, prisma } = harness();

      await expect(
        service.upsert(
          branchAdmin(),
          {
            settingCode: 'BRANCH_CASH_LIMIT_PAISE',
            branchId: BRANCH_B,
            value: '100000',
            changeReason: 'r',
          },
          META,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.settingChangeRequest.create).not.toHaveBeenCalled();
    });

    it('refuses a branch admin writing an organization-scoped setting', async () => {
      const { service } = harness();

      await expect(
        service.upsert(
          branchAdmin(),
          { settingCode: 'ORG_DISPLAY_NAME', value: 'x', changeReason: 'r' },
          META,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('hides another branch row behind the same not-found message', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(
        settingRow({ branchId: BRANCH_B }),
      );

      await expect(
        service.get(branchAdmin(), SETTING_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets a branch admin see their own branch and the org defaults', async () => {
      const { service, prisma } = harness();

      await service.list(branchAdmin(), {});

      expect(prisma.setting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: ORG_ID,
            OR: [{ branchId: BRANCH_A }, { branchId: null }],
          }),
        }),
      );
    });

    it('always filters by the caller orgId', async () => {
      const { service, prisma } = harness();

      await service.list(superAdmin(), {});

      const where = prisma.setting.findMany.mock.calls[0][0].where as {
        orgId: string;
      };
      expect(where.orgId).toBe(ORG_ID);
    });
  });

  describe('lifecycle', () => {
    it('revalidates before reactivating (Scenario 18)', async () => {
      const { service, prisma } = harness();
      // Stored value no longer parses — reactivating it would make an invalid
      // configuration effective again.
      prisma.setting.findFirst.mockResolvedValue(settingRow({ valueJson: '' }));

      await expect(
        service.setStatus(superAdmin(), SETTING_ID, 'ACTIVE', 3, META),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.setting.updateMany).not.toHaveBeenCalled();
    });

    it('deactivates without revalidating, so a bad value can still be retired', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow({ valueJson: '' }));

      await service.setStatus(superAdmin(), SETTING_ID, 'INACTIVE', 3, META);

      expect(prisma.setting.updateMany).toHaveBeenCalled();
    });

    it('blocks deleting a setting with change history (Scenario 16)', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow());
      prisma.settingChangeRequest.count.mockResolvedValue(2);

      await expect(
        service.remove(superAdmin(), SETTING_ID, META),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.setting.delete).not.toHaveBeenCalled();
    });

    it('blocks deleting a protected setting outright', async () => {
      const { service, prisma } = harness();
      prisma.setting.findFirst.mockResolvedValue(
        settingRow({ settingCode: 'AUDIT_EXPORT_MAX_DAYS', valueJson: 90 }),
      );

      await expect(
        service.remove(superAdmin(), SETTING_ID, META),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.setting.delete).not.toHaveBeenCalled();
    });

    it('deletes an unreferenced setting and audits it (Scenario 17)', async () => {
      const { service, prisma, audit } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow());
      prisma.settingChangeRequest.count.mockResolvedValue(0);

      await service.remove(superAdmin(), SETTING_ID, META);

      expect(prisma.setting.delete).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SETTING_DELETED }),
      );
    });
  });

  describe('catalog', () => {
    it('exposes the registry so the UI cannot offer an unsupported code', () => {
      const { service } = harness();
      const catalog = service.catalog();

      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.every((entry) => entry.code.length > 0)).toBe(true);
      expect(catalog.some((entry) => entry.requiresApproval)).toBe(true);
    });
  });
});
