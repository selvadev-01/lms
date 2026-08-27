import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuditQueryService } from './audit-query.service';
import { AuditAction, AuditService } from './audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Module 17 — reading the audit trail.
 *
 * Four properties carry the weight:
 *
 * 1. **Branch confinement keeps its NULL fallback.** `audit_logs.branch_id` was
 *    retrofitted, so every legacy row carries NULL. Collapsing the clause to
 *    `branchId: actor.branchId` would hide all of them — and an empty list looks
 *    like a working filter rather than a fault, which is why it is pinned here.
 * 2. **The export audits itself before writing data** (Rule 57). An export that
 *    fails halfway must still leave evidence it was attempted.
 * 3. **Redaction follows the permission** (Scenario 39), and applies to the
 *    export as much as the screen — an export that widened it would be a way to
 *    read past the screen's limits.
 * 4. **An oversized export is refused, not truncated.** A truncated export is
 *    indistinguishable from a complete one once it is open in a spreadsheet.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_A = '44444444-4444-4444-4444-444444444444';
const BRANCH_B = '55555555-5555-5555-5555-555555555555';
const AUDIT_ID = '66666666-6666-6666-6666-666666666666';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['audit.view', 'audit.export', 'audit.sensitive.view'],
    ...overrides,
  };
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    auditId: AUDIT_ID,
    occurredAt: new Date('2026-08-20T10:00:00Z'),
    actorUserId: USER_ID,
    action: 'SETTING_UPDATED',
    entityType: 'setting',
    entityId: null,
    branchId: null,
    requestId: null,
    ipAddress: '203.0.113.7',
    userAgent: 'agent',
    oldData: { value: 'before' },
    newData: { value: 'after' },
    metadata: { settingCode: 'ORG_DISPLAY_NAME' },
    actorUser: { name: 'Super Admin', branchId: null },
    ...overrides,
  };
}

function harness(rowCount = 1) {
  const prisma = {
    auditLog: {
      findMany: jest.fn().mockResolvedValue([auditRow()]),
      findFirst: jest.fn().mockResolvedValue(auditRow()),
      count: jest.fn().mockResolvedValue(rowCount),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new AuditQueryService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  return { service, prisma, audit };
}

describe('AuditQueryService', () => {
  describe('branch confinement (Scenario 36)', () => {
    it('keeps the NULL fallback so legacy events stay visible', async () => {
      const { service, prisma } = harness();

      await service.list(actor({ branchId: BRANCH_A }), {});

      const where = prisma.auditLog.findMany.mock.calls[0][0].where as {
        OR: unknown[];
      };
      // Both arms are required. Dropping the second hides every row written
      // before Module 17 added the column.
      expect(where.OR).toEqual([
        { branchId: BRANCH_A },
        { branchId: null, actorUser: { branchId: BRANCH_A } },
      ]);
    });

    it('does not confine an organization-wide caller', async () => {
      const { service, prisma } = harness();

      await service.list(actor(), {});

      const where = prisma.auditLog.findMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      expect(where.OR).toBeUndefined();
      expect(where.orgId).toBe(ORG_ID);
    });

    it('refuses a branch-confined caller filtering to another branch', async () => {
      const { service } = harness();

      await expect(
        service.list(actor({ branchId: BRANCH_A }), { branchId: BRANCH_B }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an org-wide caller narrow to one branch', async () => {
      const { service, prisma } = harness();

      await service.list(actor(), { branchId: BRANCH_B });

      const where = prisma.auditLog.findMany.mock.calls[0][0].where as {
        branchId: string;
      };
      expect(where.branchId).toBe(BRANCH_B);
    });

    it('always scopes to the caller orgId, never the request', async () => {
      const { service, prisma } = harness();

      await service.list(actor(), {});

      expect(
        (prisma.auditLog.findMany.mock.calls[0][0].where as { orgId: string })
          .orgId,
      ).toBe(ORG_ID);
    });

    it('hides another branch event on a direct fetch (Scenario 46)', async () => {
      const { service, prisma } = harness();
      prisma.auditLog.findFirst.mockResolvedValue(
        auditRow({ branchId: BRANCH_B }),
      );

      await expect(
        service.get(actor({ branchId: BRANCH_A }), AUDIT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a NULL-branch event authored in the caller branch', async () => {
      const { service, prisma } = harness();
      prisma.auditLog.findFirst.mockResolvedValue(
        auditRow({
          branchId: null,
          actorUser: { name: 'A', branchId: BRANCH_A },
        }),
      );

      const detail = await service.get(actor({ branchId: BRANCH_A }), AUDIT_ID);
      expect(detail.auditId).toBe(AUDIT_ID);
    });
  });

  describe('redaction (Scenario 39)', () => {
    it('redacts before/after values without audit.sensitive.view', async () => {
      const { service } = harness();

      const detail = await service.get(
        actor({ permissions: ['audit.view'] }),
        AUDIT_ID,
      );

      expect(detail.isRedacted).toBe(true);
      expect(detail.oldData).not.toEqual({ value: 'before' });
      expect(detail.newData).not.toEqual({ value: 'after' });
    });

    it('shows them to a caller who holds the permission', async () => {
      const { service } = harness();

      const detail = await service.get(actor(), AUDIT_ID);

      expect(detail.isRedacted).toBe(false);
      expect(detail.oldData).toEqual({ value: 'before' });
    });

    it('redacts the export for the same caller', async () => {
      const { service } = harness();

      const csv = await service.exportCsv(
        actor({ permissions: ['audit.view', 'audit.export'] }),
        { from: '2026-08-01', to: '2026-08-25' },
        META,
      );

      expect(csv).not.toContain('before');
      expect(csv).toContain('[redacted]');
    });
  });

  describe('export (Scenarios 41, 42)', () => {
    it('writes its own audit row before serialising data', async () => {
      const { service, audit } = harness();

      await service.exportCsv(
        actor(),
        { from: '2026-08-01', to: '2026-08-25' },
        META,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.AUDIT_EXPORTED,
          metadata: expect.objectContaining({ rowCount: 1 }),
        }),
      );
    });

    it('requires both ends of the date range', async () => {
      const { service } = harness();

      await expect(
        service.exportCsv(actor(), { from: '2026-08-01' }, META),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an oversized export rather than truncating it', async () => {
      const { service, audit } = harness(20_000);

      await expect(
        service.exportCsv(
          actor(),
          { from: '2026-08-01', to: '2026-08-25' },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AUDIT_EXPORT_DENIED }),
      );
    });

    it('refuses an inverted range', async () => {
      const { service } = harness();

      await expect(
        service.exportCsv(
          actor(),
          { from: '2026-08-25', to: '2026-08-01' },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('emits a BOM so Excel reads the UTF-8 correctly', async () => {
      const { service } = harness();

      const csv = await service.exportCsv(
        actor(),
        { from: '2026-08-01', to: '2026-08-25' },
        META,
      );

      expect(csv.startsWith('﻿')).toBe(true);
      expect(csv).toContain('Occurred At');
    });
  });

  describe('the read path cannot write', () => {
    it('exposes no update or delete method', () => {
      const { service } = harness();
      const surface = Object.getOwnPropertyNames(
        Object.getPrototypeOf(service),
      );

      // Rule 54: viewing an audit event must not permit modifying it. The
      // database refuses it too, but the absence here is the first line.
      expect(surface).not.toContain('update');
      expect(surface).not.toContain('delete');
      expect(surface).not.toContain('remove');
    });
  });
});
