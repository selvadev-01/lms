import { ConflictException, ForbiddenException } from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { SettingChangeService } from './setting-change.service';

/**
 * Module 17 — maker-checker.
 *
 * Three properties carry the weight, and all three fail silently if broken:
 *
 * 1. **Self-approval is refused.** Scenario 11. There is no policy flag that
 *    permits it, so this test also guards against one being introduced: if
 *    somebody adds an escape hatch, this fails.
 * 2. **Terminal states are terminal.** Scenario 13. A rejected request that
 *    could still be applied would make the rejection meaningless — and nothing
 *    else in the system re-checks it.
 * 3. **Apply-time revalidation catches a setting that moved.** Scenario 63. An
 *    approval can arrive days after the proposal; applying on the strength of
 *    the submission-time check would silently overwrite a newer value.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const MAKER_ID = '22222222-2222-2222-2222-222222222222';
const CHECKER_ID = '77777777-7777-7777-7777-777777777777';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const REQUEST_ID = '66666666-6666-6666-6666-666666666666';
const SETTING_ID = '99999999-9999-9999-9999-999999999999';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function actorWith(userId: string): AuthContext {
  return {
    userId,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['settings.changes.view', 'settings.changes.approve'],
  };
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    changeRequestId: REQUEST_ID,
    changeRequestNumber: 'CHG-000001',
    branchId: null,
    settingId: SETTING_ID,
    settingCode: 'AUDIT_EXPORT_MAX_DAYS',
    requestedValueJson: '90',
    baseVersion: 2,
    resultVersion: null,
    changeReason: 'Tighten the window',
    status: 'PENDING_APPROVAL',
    requestedBy: MAKER_ID,
    submittedAt: new Date('2026-08-20T00:00:00Z'),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    appliedAt: null,
    failureReason: null,
    ...overrides,
  };
}

function settingRow(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    settingId: SETTING_ID,
    branchId: null,
    settingCode: 'AUDIT_EXPORT_MAX_DAYS',
    settingCategory: 'SECURITY',
    valueType: 'INTEGER',
    valueJson: 30,
    status: 'ACTIVE',
    version: 2,
    isProtected: true,
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    ...overrides,
  };
}

function harness() {
  const tx = {
    setting: {
      update: jest
        .fn()
        .mockResolvedValue(settingRow({ version: 3, valueJson: 90 })),
      create: jest
        .fn()
        .mockResolvedValue(settingRow({ version: 1, valueJson: 90 })),
    },
    settingChangeRequest: {
      update: jest
        .fn()
        .mockResolvedValue(requestRow({ status: 'APPLIED', resultVersion: 3 })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    settingChangeRequest: {
      findFirst: jest.fn().mockResolvedValue(requestRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(requestRow({ status: 'REJECTED' })),
    },
    setting: {
      findFirst: jest.fn().mockResolvedValue(settingRow()),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new SettingChangeService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  return { service, prisma, audit, tx };
}

describe('SettingChangeService', () => {
  describe('self-approval (Scenario 11)', () => {
    it('refuses the maker approving their own change', async () => {
      const { service, prisma } = harness();

      await expect(
        service.approve(actorWith(MAKER_ID), REQUEST_ID, META),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Nothing was applied.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('audits the denial', async () => {
      const { service, audit } = harness();

      await service
        .approve(actorWith(MAKER_ID), REQUEST_ID, META)
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SETTING_CHANGE_SELF_APPROVAL_DENIED,
        }),
      );
    });

    it('leaves the request pending so another approver can act', async () => {
      const { service, prisma } = harness();

      await service
        .approve(actorWith(MAKER_ID), REQUEST_ID, META)
        .catch(() => undefined);

      expect(prisma.settingChangeRequest.update).not.toHaveBeenCalled();
    });

    it('allows a different approver', async () => {
      const { service, prisma } = harness();

      const result = await service.approve(
        actorWith(CHECKER_ID),
        REQUEST_ID,
        META,
      );

      expect(result.status).toBe('APPLIED');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('terminal states (Scenario 13)', () => {
    it.each(['REJECTED', 'CANCELLED', 'APPLIED', 'FAILED'])(
      'refuses to approve a %s request',
      async (status) => {
        const { service, prisma } = harness();
        prisma.settingChangeRequest.findFirst.mockResolvedValue(
          requestRow({ status }),
        );

        await expect(
          service.approve(actorWith(CHECKER_ID), REQUEST_ID, META),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('refuses to reject an already-rejected request', async () => {
      const { service, prisma } = harness();
      prisma.settingChangeRequest.findFirst.mockResolvedValue(
        requestRow({ status: 'REJECTED' }),
      );

      await expect(
        service.reject(actorWith(CHECKER_ID), REQUEST_ID, 'no', META),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('apply-time revalidation (Scenario 63)', () => {
    it('fails the request when the setting moved since submission', async () => {
      const { service, prisma, tx } = harness();
      // Submitted against version 2; the live row is now at 5.
      prisma.setting.findFirst.mockResolvedValue(settingRow({ version: 5 }));

      await expect(
        service.approve(actorWith(CHECKER_ID), REQUEST_ID, META),
      ).rejects.toBeInstanceOf(ConflictException);

      // The newer value was NOT overwritten.
      expect(tx.setting.update).not.toHaveBeenCalled();
      expect(prisma.settingChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('audits the apply failure with a reason', async () => {
      const { service, prisma, audit } = harness();
      prisma.setting.findFirst.mockResolvedValue(settingRow({ version: 5 }));

      await service
        .approve(actorWith(CHECKER_ID), REQUEST_ID, META)
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SETTING_CHANGE_APPLY_FAILED,
          metadata: expect.objectContaining({ reason: expect.any(String) }),
        }),
      );
    });

    it('fails the request when the stored value is no longer valid', async () => {
      const { service, prisma, tx } = harness();
      prisma.settingChangeRequest.findFirst.mockResolvedValue(
        // 400 exceeds the definition's 366-day ceiling.
        requestRow({ requestedValueJson: '400' }),
      );

      await expect(
        service.approve(actorWith(CHECKER_ID), REQUEST_ID, META),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.setting.update).not.toHaveBeenCalled();
    });

    it('applies when the version still matches', async () => {
      const { service, tx } = harness();

      await service.approve(actorWith(CHECKER_ID), REQUEST_ID, META);

      expect(tx.setting.update).toHaveBeenCalled();
    });

    it('creates the setting when the request proposed the first value', async () => {
      const { service, prisma, tx } = harness();
      prisma.settingChangeRequest.findFirst.mockResolvedValue(
        requestRow({ settingId: null, baseVersion: 0 }),
      );
      prisma.setting.findFirst.mockResolvedValue(null);

      await service.approve(actorWith(CHECKER_ID), REQUEST_ID, META);

      expect(tx.setting.create).toHaveBeenCalled();
      expect(tx.setting.update).not.toHaveBeenCalled();
    });
  });

  describe('approval writes inside the transaction', () => {
    it('records the audit rows through the transaction client', async () => {
      const { service, audit, tx } = harness();

      await service.approve(actorWith(CHECKER_ID), REQUEST_ID, META);

      // Second argument is the tx client: an approval that rolls back must not
      // leave an audit row claiming it happened.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SETTING_CHANGE_APPROVED,
        }),
        tx,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SETTING_CHANGE_APPLIED }),
        tx,
      );
    });
  });

  describe('rejection and cancellation', () => {
    it('records the rejection reason (Scenario 12)', async () => {
      const { service, prisma, audit } = harness();

      await service.reject(actorWith(CHECKER_ID), REQUEST_ID, 'Too wide', META);

      expect(prisma.settingChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'Too wide',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SETTING_CHANGE_REJECTED,
        }),
      );
    });

    it('lets only the submitter cancel', async () => {
      const { service } = harness();

      await expect(
        service.cancel(actorWith(CHECKER_ID), REQUEST_ID, META),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the submitter to cancel their own request', async () => {
      const { service, prisma } = harness();
      prisma.settingChangeRequest.update.mockResolvedValue(
        requestRow({ status: 'CANCELLED' }),
      );

      const result = await service.cancel(
        actorWith(MAKER_ID),
        REQUEST_ID,
        META,
      );

      expect(result.status).toBe('CANCELLED');
    });
  });
});
