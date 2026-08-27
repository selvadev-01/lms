import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';

import { RetentionPolicyService } from './retention-policy.service';

/**
 * Module 17 — data retention policies (Scenarios 55-58).
 *
 * Four properties carry the weight, each because its failure destroys evidence
 * silently rather than raising anything:
 *
 * 1. **Immutability is derived from the category, never accepted from input.**
 *    If a DTO could set `immutableEvidence`, a caller could mark ledger evidence
 *    purgeable — precisely what Rule 76 forbids. Nothing downstream re-checks.
 * 2. **A purge with no active policy is refused.** Defaulting to "purge anyway"
 *    would make an unconfigured system the most destructive one (Scenario 57).
 * 3. **A referenced policy cannot be deleted.** Deleting one whose decisions are
 *    already reflected in purged data leaves audit history pointing at a policy
 *    that no longer exists (Scenario 56).
 * 4. **A blocked purge is audited.** Scenario 58 requires the refusal to be
 *    recorded; one that left no trace is indistinguishable from an attempt
 *    never made.
 *
 * The CHECK constraints and the partial unique index are verified against the
 * real database (the migration cannot be exercised through a mocked client);
 * this file covers the decisions the service makes.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const POLICY_ID = '66666666-6666-6666-6666-666666666666';

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: '33333333-3333-3333-3333-333333333333',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['retention.policies.view', 'retention.policies.manage'],
    ...overrides,
  };
}

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    retentionPolicyId: POLICY_ID,
    name: 'Session retention',
    recordCategory: 'USER_SESSION',
    retentionPeriodDays: 90,
    archiveAfterDays: null,
    purgeAfterDays: 365,
    immutableEvidence: false,
    legalHoldSupported: false,
    status: 'ACTIVE',
    referencedAt: null,
    version: 1,
    createdBy: USER_ID,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedBy: USER_ID,
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  service: RetentionPolicyService;
  prisma: { retentionPolicy: Record<string, jest.Mock> };
  audit: { record: jest.Mock };
}

/**
 * The `data` the service passed to `create`.
 *
 * Read back as a typed value rather than asserted with a nested
 * `expect.objectContaining`, which the lint config cannot narrow through.
 */
function createdData(prisma: Harness['prisma']): Record<string, unknown> {
  const call = prisma.retentionPolicy.create.mock.calls[0] as [
    { data: Record<string, unknown> },
  ];
  return call[0].data;
}

function harness(): Harness {
  const prisma = {
    retentionPolicy: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new RetentionPolicyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );

  return { service, prisma, audit };
}

describe('RetentionPolicyService', () => {
  describe('create', () => {
    it('derives immutableEvidence from the category rather than the input', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(policyRow(data)),
      );

      await service.create(actor(), {
        name: 'Ledger retention',
        recordCategory: 'LEDGER_ENTRY',
        retentionPeriodDays: 2555,
      });

      expect(createdData(prisma).immutableEvidence).toBe(true);
    });

    it('marks a non-evidence category as purgeable', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(policyRow(data)),
      );

      await service.create(actor(), {
        name: 'Session retention',
        recordCategory: 'USER_SESSION',
        retentionPeriodDays: 90,
      });

      expect(createdData(prisma).immutableEvidence).toBe(false);
    });

    // Rule 76 — the message names the rule, because a bare constraint violation
    // would leave the caller guessing which field to change.
    it('refuses a purge schedule on immutable evidence', async () => {
      const { service, prisma } = harness();

      await expect(
        service.create(actor(), {
          name: 'Audit retention',
          recordCategory: 'AUDIT_LOG',
          retentionPeriodDays: 2555,
          purgeAfterDays: 3000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.retentionPolicy.create).not.toHaveBeenCalled();
    });

    it('refuses a purge scheduled before the retention period elapses', async () => {
      const { service, prisma } = harness();

      await expect(
        service.create(actor(), {
          name: 'Bad',
          recordCategory: 'REPORT_RUN',
          retentionPeriodDays: 90,
          purgeAfterDays: 30,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.retentionPolicy.create).not.toHaveBeenCalled();
    });

    it('translates the unique violation instead of leaking a 503', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create(actor(), {
          name: 'Dupe',
          recordCategory: 'USER_SESSION',
          retentionPeriodDays: 90,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('treats a stale version as a conflict rather than overwriting', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(policyRow());
      prisma.retentionPolicy.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update(actor(), POLICY_ID, {
          name: 'Renamed',
          expectedVersion: 99,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to add a purge schedule to immutable evidence', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(
        policyRow({
          recordCategory: 'AUDIT_LOG',
          immutableEvidence: true,
          purgeAfterDays: null,
        }),
      );

      await expect(
        service.update(actor(), POLICY_ID, {
          purgeAfterDays: 4000,
          expectedVersion: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.retentionPolicy.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    // Scenario 56 — deactivation is the sanctioned alternative, and the message
    // says so rather than leaving the caller to conclude the policy is stuck.
    it('blocks deleting a policy that has governed processing', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(
        policyRow({ referencedAt: new Date('2026-08-25T00:00:00Z') }),
      );

      await expect(service.remove(actor(), POLICY_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(prisma.retentionPolicy.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes a policy that has never been referenced', async () => {
      const { service, prisma, audit } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(policyRow());
      prisma.retentionPolicy.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(actor(), POLICY_ID);

      expect(prisma.retentionPolicy.deleteMany).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RETENTION_POLICY_DELETED' }),
      );
    });

    it('reports an absent policy as not found rather than confirming it exists elsewhere', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(null);

      await expect(service.remove(actor(), POLICY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertPurgeAllowed', () => {
    it('refuses when no active policy governs the category', async () => {
      const { service, prisma, audit } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.assertPurgeAllowed(actor(), 'USER_SESSION'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Scenario 58: the refusal is recorded for operational review.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RETENTION_PURGE_BLOCKED' }),
      );
    });

    it('refuses to purge immutable evidence', async () => {
      const { service, prisma, audit } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(
        policyRow({
          recordCategory: 'LEDGER_ENTRY',
          immutableEvidence: true,
          purgeAfterDays: null,
        }),
      );

      await expect(
        service.assertPurgeAllowed(actor(), 'LEDGER_ENTRY'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RETENTION_PURGE_BLOCKED' }),
      );
    });

    it('refuses when a legal hold applies', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(
        policyRow({ legalHoldSupported: true }),
      );

      await expect(
        service.assertPurgeAllowed(actor(), 'USER_SESSION', {
          legalHold: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when the active policy sets no purge schedule', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(
        policyRow({ purgeAfterDays: null }),
      );

      await expect(
        service.assertPurgeAllowed(actor(), 'USER_SESSION'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a purge under a coherent active policy', async () => {
      const { service, prisma, audit } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(policyRow());

      const policy = await service.assertPurgeAllowed(actor(), 'USER_SESSION');

      expect(policy.purgeAfterDays).toBe(365);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('resolveForProcessing', () => {
    // Scenario 57 — an inactive policy is never selected, so the query must
    // constrain status rather than filtering after the fact.
    it('only ever selects an ACTIVE policy', async () => {
      const { service, prisma } = harness();
      prisma.retentionPolicy.findFirst.mockResolvedValue(null);

      await service.resolveForProcessing(ORG_ID, 'USER_SESSION');

      expect(prisma.retentionPolicy.findFirst).toHaveBeenCalledWith({
        where: {
          orgId: ORG_ID,
          recordCategory: 'USER_SESSION',
          status: 'ACTIVE',
        },
      });
    });
  });
});
