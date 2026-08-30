import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationService } from './organization.service';

/**
 * Company Settings — the caller's own organization.
 *
 * The load-bearing property under test is negative: `orgId` is never read from
 * a request. Every method resolves it from `AuthContext`, so there is no
 * parameter through which another tenant could be named (Scenario 37). The
 * tests below therefore focus on what the service *does* with that fixed
 * scope — the before/after audit trail, and the lifecycle fields that must move
 * together with status.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

/**
 * `expect.objectContaining` is typed `any`, which trips `no-unsafe-assignment`
 * as soon as it is nested inside an object literal. Narrowing it once here
 * keeps the assertions below both readable and type-safe.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function superAdminContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['organizations.view', 'organizations.update'],
    ...overrides,
  };
}

interface OrgRecord {
  orgId: string;
  code: string;
  name: string;
  legalName: string | null;
  logoFileRef: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  timezone: string;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function orgRecord(overrides: Partial<OrgRecord> = {}): OrgRecord {
  return {
    orgId: ORG_ID,
    code: 'DEMO',
    name: 'Demo Finance Ltd',
    legalName: 'Demo Finance Private Limited',
    logoFileRef: null,
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    deactivatedAt: null,
    deactivationReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('OrganizationService', () => {
  let service: OrganizationService;
  let audit: { record: jest.Mock };
  let sessions: { revokeAllForOrg: jest.Mock };
  let organizations: OrgRecord[];

  beforeEach(() => {
    organizations = [orgRecord()];

    const delegate = {
      // Copies on read, as a real client does: handing back the live object
      // would let a later update retroactively change what an earlier read
      // saw, silently defeating the before/after audit assertions.
      findUnique: jest.fn(({ where }: { where: { orgId: string } }) => {
        const row = organizations.find(
          (candidate) => candidate.orgId === where.orgId,
        );
        return Promise.resolve(row ? { ...row } : null);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { orgId: string };
          data: Partial<OrgRecord>;
        }) => {
          const row = organizations.find(
            (candidate) => candidate.orgId === where.orgId,
          );
          if (!row) throw new Error('organization not found');
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        },
      ),
    };

    const client = { organization: delegate };
    const prisma = {
      ...client,
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(client),
      ),
    } as unknown as PrismaService;

    audit = { record: jest.fn().mockResolvedValue(undefined) };
    sessions = { revokeAllForOrg: jest.fn().mockResolvedValue(0) };

    service = new OrganizationService(
      prisma,
      audit as unknown as AuditService,
      sessions as unknown as SessionService,
    );
  });

  describe('getOwn', () => {
    it('returns the caller’s own organization', async () => {
      const result = await service.getOwn(superAdminContext(), META);

      expect(result.code).toBe('DEMO');
      expect(result.orgId).toBe(ORG_ID);
    });

    it('audits the view', async () => {
      // Scenarios 1, 2: seeing the organizational structure is itself
      // privileged, so the read is logged as well as the write.
      await service.getOwn(superAdminContext(), META);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORG_VIEWED,
          entityId: ORG_ID,
        }),
      );
    });

    it('resolves only the organization named by the token', async () => {
      // Scenario 37: another tenant's row exists but is unreachable, because
      // the lookup key comes from AuthContext and nowhere else.
      organizations.push(
        orgRecord({
          orgId: '99999999-9999-9999-9999-999999999999',
          code: 'OTHERORG',
        }),
      );

      const result = await service.getOwn(superAdminContext(), META);

      expect(result.code).toBe('DEMO');
    });

    it('refuses when the token names an organization that does not exist', async () => {
      organizations = [];

      await expect(
        service.getOwn(superAdminContext(), META),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateOwn', () => {
    it('saves the change', async () => {
      const result = await service.updateOwn(
        superAdminContext(),
        { name: 'Demo Finance Limited' },
        META,
      );

      expect(result.name).toBe('Demo Finance Limited');
    });

    it('preserves the organization identifier and code', async () => {
      // Scenario 6. Neither is in the DTO, so neither can drift.
      const result = await service.updateOwn(
        superAdminContext(),
        { name: 'Renamed' },
        META,
      );

      expect(result.orgId).toBe(ORG_ID);
      expect(result.code).toBe('DEMO');
    });

    it('records previous and current values', async () => {
      // Scenario 52: an auditor must be able to see what changed.
      await service.updateOwn(superAdminContext(), { name: 'Renamed' }, META);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORG_UPDATED,
          oldData: containing({ name: 'Demo Finance Ltd' }),
          newData: containing({ name: 'Renamed' }),
        }),
        expect.anything(),
      );
    });

    it('does not change status', async () => {
      // Scenario 7 in miniature: an edit is an edit. Status moves only through
      // setStatus, which carries its own permission and audit action.
      await service.updateOwn(superAdminContext(), { name: 'Renamed' }, META);

      expect(organizations[0].status).toBe('ACTIVE');
    });

    it('clears legalName when omitted', async () => {
      const result = await service.updateOwn(
        superAdminContext(),
        { name: 'Demo Finance Ltd' },
        META,
      );

      expect(result.legalName).toBeUndefined();
    });

    it('leaves the timezone untouched when omitted', async () => {
      // Unlike legalName, an absent timezone means "unchanged" rather than
      // "cleared" — the column is non-nullable and has a meaningful default.
      await service.updateOwn(superAdminContext(), { name: 'Renamed' }, META);

      expect(organizations[0].timezone).toBe('Asia/Kolkata');
    });
  });

  describe('setStatus', () => {
    it('deactivates and records the reason', async () => {
      const result = await service.setStatus(
        superAdminContext(),
        { status: 'INACTIVE', reason: 'Licence suspended' },
        META,
      );

      expect(result.status).toBe('INACTIVE');
      expect(result.deactivationReason).toBe('Licence suspended');
      expect(result.deactivatedAt).toBeDefined();
    });

    it('reactivates and clears the deactivation fields', async () => {
      organizations[0].status = 'INACTIVE';
      organizations[0].deactivatedAt = new Date();
      organizations[0].deactivationReason = 'Licence suspended';

      const result = await service.setStatus(
        superAdminContext(),
        { status: 'ACTIVE' },
        META,
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.deactivatedAt).toBeUndefined();
      expect(result.deactivationReason).toBeUndefined();
    });

    it('refuses a no-op transition', async () => {
      await expect(
        service.setStatus(superAdminContext(), { status: 'ACTIVE' }, META),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /**
     * Per-request authorization re-reads the *user's* status, never the
     * organization's, so nothing else notices a deactivated tenant until a
     * token lapses and its holder reaches the refresh endpoint. Ending the
     * sessions here is what makes the deactivation take effect immediately.
     */
    it('revokes every session in the organization on deactivation', async () => {
      await service.setStatus(
        superAdminContext(),
        { status: 'INACTIVE', reason: 'Licence suspended' },
        META,
      );

      expect(sessions.revokeAllForOrg).toHaveBeenCalledWith(
        ORG_ID,
        'ORG_INACTIVE',
      );
    });

    it('does not revoke sessions when reactivating', async () => {
      organizations[0].status = 'INACTIVE';

      await service.setStatus(superAdminContext(), { status: 'ACTIVE' }, META);

      expect(sessions.revokeAllForOrg).not.toHaveBeenCalled();
    });

    /**
     * The revocation runs after the transaction commits, so its failure must
     * not roll the deactivation back — the organization is off either way, and
     * a surviving session row is refused by the refresh path regardless.
     */
    it('still deactivates when session revocation fails', async () => {
      sessions.revokeAllForOrg.mockRejectedValue(new Error('store down'));

      const result = await service.setStatus(
        superAdminContext(),
        { status: 'INACTIVE' },
        META,
      );

      expect(result.status).toBe('INACTIVE');
    });

    it('audits deactivation and activation under distinct actions', async () => {
      await service.setStatus(
        superAdminContext(),
        { status: 'INACTIVE' },
        META,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORG_DEACTIVATED,
          oldData: { status: 'ACTIVE' },
          newData: { status: 'INACTIVE' },
        }),
        expect.anything(),
      );
    });

    it('touches no other row', async () => {
      // Scenarios 11, 41: deactivation is a gate on new transactions, not a
      // retroactive edit of everything that already happened, and it creates
      // no ledger line. The service having exactly one writable delegate is
      // what makes that structurally true.
      organizations.push(
        orgRecord({
          orgId: '99999999-9999-9999-9999-999999999999',
          code: 'OTHERORG',
        }),
      );

      await service.setStatus(
        superAdminContext(),
        { status: 'INACTIVE' },
        META,
      );

      expect(organizations[1].status).toBe('ACTIVE');
    });
  });
});
