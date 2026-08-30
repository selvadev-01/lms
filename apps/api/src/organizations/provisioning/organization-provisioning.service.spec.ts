import { ConflictException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import { LEDGER_ACCOUNT_SPECS } from '../../loans/disbursal/ledger-accounts';
import {
  NOTIFICATION_RULE_SPECS,
  NOTIFICATION_TEMPLATE_SPECS,
} from '../../notifications/notification-seed-specs';
import { PrismaService } from '../../prisma/prisma.service';
import { ALL_PERMISSION_CODES } from '../../users/rbac/permission-catalog';
import { MASTER_DATA_SPECS } from './master-data-specs';
import { OrganizationProvisioningService } from './organization-provisioning.service';
import { CORE_ROLE_GRANTS, CORE_ROLE_SPECS } from './role-specs';

/**
 * Standing up a new organization.
 *
 * The property under test is completeness: an organization that is missing any
 * one of these pieces signs in perfectly well and then fails later, somewhere
 * unrelated to the omission. Without ledger accounts the first disbursal 409s
 * from deep inside `LedgerService`; without master data the customer form
 * renders empty dropdowns. Both read as bugs in the module that broke, not as a
 * provisioning gap, which is why the counts below are asserted rather than
 * assumed.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const BRANCH_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

const INPUT = {
  orgName: 'Kestrel Finance',
  orgCode: 'KESTREL',
  adminName: 'Asha R',
  adminMobile: '9876543210',
  adminPasswordHash: '$argon2id$fake',
};

function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

/**
 * A transaction client that records every write, and hands back ids in the
 * shape `createManyAndReturn` would, so the service's in-memory id maps
 * resolve.
 */
function createTx() {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ orgId: ORG_ID }),
    },
    branch: {
      create: jest.fn().mockResolvedValue({ branchId: BRANCH_ID }),
    },
    permission: {
      createManyAndReturn: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          (data as Array<{ code: string }>).map((row, index) => ({
            permissionId: `perm-${index}`,
            code: row.code,
          })),
        ),
      ),
    },
    role: {
      createManyAndReturn: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          (data as Array<{ code: string }>).map((row, index) => ({
            roleId: `role-${index}`,
            code: row.code,
          })),
        ),
      ),
    },
    rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    masterDataValue: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    account: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    notificationTemplate: {
      createManyAndReturn: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          (data as Array<{ code: string; channel: string }>).map(
            (row, index) => ({
              templateId: `tpl-${index}`,
              code: row.code,
              channel: row.channel,
            }),
          ),
        ),
      ),
    },
    notificationEventRule: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { create: jest.fn().mockResolvedValue({ userId: USER_ID }) },
    userRole: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

type Tx = ReturnType<typeof createTx>;

function setup(tx: Tx = createTx()) {
  const transaction = jest.fn(
    async (fn: (client: Tx) => Promise<unknown>) => await fn(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new OrganizationProvisioningService(
    prisma,
    audit as unknown as AuditService,
  );

  return { service, transaction, audit, tx };
}

/** The rows a `createMany` call was given. */
function rowsOf(mock: jest.Mock): Array<Record<string, unknown>> {
  const calls = mock.mock.calls as Array<
    [{ data: Array<Record<string, unknown>> }]
  >;
  return calls[0][0].data;
}

describe('OrganizationProvisioningService', () => {
  describe('completeness', () => {
    it('provisions every piece a usable organization needs', async () => {
      const { service, tx } = setup();

      const result = await service.provision(INPUT, META);

      expect(result.counts).toEqual({
        permissions: ALL_PERMISSION_CODES.length,
        roles: CORE_ROLE_SPECS.length,
        grants: Object.values(CORE_ROLE_GRANTS).reduce(
          (total, codes) => total + codes.length,
          0,
        ),
        masterDataValues: MASTER_DATA_SPECS.length,
        accounts: LEDGER_ACCOUNT_SPECS.length,
        templates: NOTIFICATION_TEMPLATE_SPECS.length,
        eventRules: NOTIFICATION_RULE_SPECS.length,
      });

      expect(tx.organization.create).toHaveBeenCalledTimes(1);
      expect(tx.branch.create).toHaveBeenCalledTimes(1);
      expect(tx.user.create).toHaveBeenCalledTimes(1);
      expect(tx.userRole.create).toHaveBeenCalledTimes(1);
    });

    it('runs everything in a single transaction', async () => {
      // A staged provisioning is how an organization ends up existing, able to
      // sign in, and unable to post to its own ledger.
      const { service, transaction } = setup();

      await service.provision(INPUT, META);

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('creates the organization ACTIVE under the code it was given', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      expect(tx.organization.create).toHaveBeenCalledWith(
        containing({
          data: containing({
            code: 'KESTREL',
            name: 'Kestrel Finance',
            status: 'ACTIVE',
          }),
        }),
      );
    });
  });

  describe('the first Super Admin', () => {
    it('is organization-wide rather than confined to the branch it created', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      expect(tx.user.create).toHaveBeenCalledWith(
        containing({
          data: containing({
            orgId: ORG_ID,
            // Null means org-wide. A Super Admin pinned to the first branch
            // could not administer the second one.
            branchId: null,
            mobile: '9876543210',
            passwordHash: '$argon2id$fake',
            status: 'ACTIVE',
          }),
        }),
      );
    });

    it('holds the SUPER_ADMIN role', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      const superAdminIndex = CORE_ROLE_SPECS.findIndex(
        (spec) => spec.code === 'SUPER_ADMIN',
      );
      expect(tx.userRole.create).toHaveBeenCalledWith(
        containing({
          data: containing({
            userId: USER_ID,
            roleId: `role-${superAdminIndex}`,
          }),
        }),
      );
    });

    it('stores only the hash it was handed', async () => {
      // The service takes `adminPasswordHash`, never a plaintext, so hashing
      // happens before the transaction opens rather than while it is held.
      const { service, tx } = setup();

      await service.provision(
        { ...INPUT, adminPasswordHash: '$argon2id$fake' },
        META,
      );

      const written = JSON.stringify(tx.user.create.mock.calls[0]);
      expect(written).toContain('$argon2id$fake');
      // Nothing resembling a plaintext secret reaches the row.
      expect(written).not.toContain('Kestrel7Vault');
      expect(Object.keys(INPUT)).not.toContain('password');
    });
  });

  describe('roles and grants', () => {
    it('marks SUPER_ADMIN a system role and the others ordinary', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      const roles = rowsOf(tx.role.createManyAndReturn);
      expect(
        Object.fromEntries(roles.map((r) => [r.code, r.isSystem])),
      ).toEqual({
        SUPER_ADMIN: true,
        BRANCH_ADMIN: false,
        FIELD_EMPLOYEE: false,
      });
    });

    it('withholds the three permissions a Super Admin must not hold', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      const permissions = rowsOf(tx.permission.createManyAndReturn);
      const permissionIdByCode = new Map(
        permissions.map((row, index) => [row.code, `perm-${index}`]),
      );
      const superAdminIndex = CORE_ROLE_SPECS.findIndex(
        (spec) => spec.code === 'SUPER_ADMIN',
      );

      const superAdminGrants = rowsOf(tx.rolePermission.createMany)
        .filter((row) => row.roleId === `role-${superAdminIndex}`)
        .map((row) => row.permissionId);

      expect(superAdminGrants).toHaveLength(ALL_PERMISSION_CODES.length - 3);
      for (const withheld of [
        'field.checkin',
        'recovery.writeoff.post',
        'retention.purge.run',
      ]) {
        expect(superAdminGrants).not.toContain(
          permissionIdByCode.get(withheld),
        );
      }
    });
  });

  describe('chart of accounts', () => {
    it('carries the posting flags from the spec, not the column defaults', async () => {
      // `isManualPostingAllowed` defaults to false, which would leave the
      // journal builder with an empty account picker.
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      const accounts = rowsOf(tx.account.createMany);
      const byCode = new Map(accounts.map((row) => [row.accountCode, row]));

      for (const spec of LEDGER_ACCOUNT_SPECS) {
        expect(byCode.get(spec.accountCode)).toEqual(
          containing({
            isManualPostingAllowed: spec.isManualPostingAllowed,
            isControlAccount: spec.isControlAccount,
            status: 'ACTIVE',
          }),
        );
      }
    });
  });

  describe('notifications', () => {
    it('writes templates before the rules that reference them', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      // The rule foreign key is RESTRICT: out of order, the insert fails.
      expect(
        tx.notificationTemplate.createManyAndReturn.mock.invocationCallOrder[0],
      ).toBeLessThan(
        tx.notificationEventRule.createMany.mock.invocationCallOrder[0],
      );
    });

    it('resolves each rule to its template by code and channel', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      const templates = rowsOf(tx.notificationTemplate.createManyAndReturn);
      const templateIdByKey = new Map(
        templates.map((row, index) => [
          `${String(row.code)}:${String(row.channel)}`,
          `tpl-${index}`,
        ]),
      );

      const rules = rowsOf(tx.notificationEventRule.createMany);
      rules.forEach((rule, index) => {
        const spec = NOTIFICATION_RULE_SPECS[index];
        expect(rule.templateId).toBe(
          templateIdByKey.get(`${spec.templateCode}:${spec.channel}`),
        );
        // Organization-wide: a branch that wants its own adds one.
        expect(rule.branchId).toBeNull();
        expect(rule.isActive).toBe(true);
      });
    });
  });

  describe('audit', () => {
    it('records the creation inside the transaction, actored by the new admin', async () => {
      const { service, audit, tx } = setup();

      await service.provision(INPUT, META);

      expect(audit.record).toHaveBeenCalledWith(
        containing({
          orgId: ORG_ID,
          branchId: BRANCH_ID,
          // Self-referential on purpose: nobody else existed to perform it.
          actorUserId: USER_ID,
          action: AuditAction.ORG_SIGNUP_COMPLETED,
          entityType: 'ORGANIZATION',
          entityId: ORG_ID,
          ipAddress: '203.0.113.7',
        }),
        tx,
      );
    });
  });

  describe('collisions', () => {
    it('refuses a code that is already taken', async () => {
      const tx = createTx();
      tx.organization.findUnique.mockResolvedValue({ orgId: 'someone-else' });
      const { service } = setup(tx);

      await expect(service.provision(INPUT, META)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.organization.create).not.toHaveBeenCalled();
    });

    it('translates a lost race into a 409 rather than a 503', async () => {
      // Untranslated, the global filter renders P2002 as "Authentication
      // service is temporarily unavailable" — wrong in every particular, and it
      // sends the user away from the one field they can fix.
      const tx = createTx();
      tx.organization.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      const { service } = setup(tx);

      const error = await service
        .provision(INPUT, META)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('KESTREL');
    });

    it('leaves any other failure to surface as itself', async () => {
      const tx = createTx();
      tx.account.createMany.mockRejectedValue(new Error('connection lost'));
      const { service } = setup(tx);

      await expect(service.provision(INPUT, META)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('branch defaults', () => {
    it('creates MAIN when the caller names no branch', async () => {
      const { service, tx } = setup();

      await service.provision(INPUT, META);

      expect(tx.branch.create).toHaveBeenCalledWith(
        containing({
          data: containing({ code: 'MAIN', name: 'Head Office' }),
        }),
      );
    });

    it('honours an explicit branch, so the seed can reuse this path', async () => {
      const { service, tx } = setup();

      await service.provision(
        { ...INPUT, branchCode: 'BR001', branchName: 'Chennai Main Branch' },
        META,
      );

      expect(tx.branch.create).toHaveBeenCalledWith(
        containing({
          data: containing({ code: 'BR001', name: 'Chennai Main Branch' }),
        }),
      );
    });
  });
});
