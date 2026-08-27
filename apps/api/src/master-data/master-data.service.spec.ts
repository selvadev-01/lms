import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateMasterDataValueDto } from './dto/create-master-data-value.dto';
import { MasterDataService } from './master-data.service';

/**
 * Master data — tenant scoping, the system-row guard, and ordering.
 *
 * Three things carry the weight here:
 *
 * 1. **Tenant scoping.** Every query must filter on the caller's `orgId` from
 *    the session. The Prisma stand-in throws on a `where` that omits it, so a
 *    relaxed query fails loudly rather than quietly returning another
 *    organization's option list.
 * 2. **The `isSystem` guard.** Seeded rows may be deactivated but never
 *    deleted. The KYC completeness check iterates document categories by code,
 *    so deleting `ID` would not raise an error — it would silently stop
 *    requiring an identity document. That is the failure this guard exists to
 *    prevent, so it is tested from both directions.
 * 3. **`isSystem` is not settable through the API.** A caller who could claim it
 *    could make a row undeletable at will.
 *
 * Real constraints, transactions and concurrent writes are deferred to e2e.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const VALUE_ID = '44444444-4444-4444-4444-444444444444';
const SYSTEM_VALUE_ID = '55555555-5555-5555-5555-555555555555';
const UNKNOWN_VALUE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function actorContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['master_data.view', 'master_data.manage'],
    ...overrides,
  };
}

interface ValueRecord {
  orgId: string;
  valueId: string;
  category: string;
  code: string;
  label: string;
  displayOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function valueRecord(overrides: Partial<ValueRecord> = {}): ValueRecord {
  return {
    orgId: ORG_ID,
    valueId: VALUE_ID,
    category: 'GENDER',
    code: 'MALE',
    label: 'Male',
    displayOrder: 10,
    status: 'ACTIVE',
    isSystem: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function validCreateDto(
  overrides: Partial<CreateMasterDataValueDto> = {},
): CreateMasterDataValueDto {
  return {
    category: 'GENDER',
    code: 'NONBINARY',
    label: 'Non-binary',
    ...overrides,
  };
}

/**
 * A Prisma stand-in that models only the shapes this service issues, and
 * rejects a `where` without an `orgId` — the point being that a query which
 * loses its tenant filter fails here rather than in production.
 */
function buildPrisma(rows: ValueRecord[]) {
  const store = [...rows];

  function assertScoped(where: Record<string, unknown> | undefined): void {
    if (!where || typeof where.orgId !== 'string') {
      throw new Error(
        `Query issued without an orgId filter: ${JSON.stringify(where)}`,
      );
    }
  }

  const delegate = {
    findMany: jest.fn(
      ({
        where,
      }: {
        where: { orgId: string; category?: string; status?: string };
        orderBy?: unknown;
      }) => {
        assertScoped(where);
        const found = store.filter(
          (row) =>
            row.orgId === where.orgId &&
            (where.category === undefined || row.category === where.category) &&
            (where.status === undefined || row.status === where.status),
        );
        // Mirrors `orderBy: [displayOrder asc, code asc]`.
        found.sort(
          (a, b) =>
            a.displayOrder - b.displayOrder || a.code.localeCompare(b.code),
        );
        return Promise.resolve(found);
      },
    ),
    findFirst: jest.fn(
      ({ where }: { where: { orgId: string; valueId: string } }) => {
        assertScoped(where);
        return Promise.resolve(
          store.find(
            (row) => row.orgId === where.orgId && row.valueId === where.valueId,
          ) ?? null,
        );
      },
    ),
    create: jest.fn(({ data }: { data: ValueRecord }) => {
      const clash = store.find(
        (row) =>
          row.orgId === data.orgId &&
          row.category === data.category &&
          row.code === data.code,
      );
      if (clash) {
        // What Prisma raises for a unique-constraint violation.
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      const row = valueRecord({ ...data, valueId: 'created-id' });
      store.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { orgId_valueId: { orgId: string; valueId: string } };
        data: Partial<ValueRecord>;
      }) => {
        const index = store.findIndex(
          (row) =>
            row.orgId === where.orgId_valueId.orgId &&
            row.valueId === where.orgId_valueId.valueId,
        );
        store[index] = { ...store[index], ...data };
        return Promise.resolve(store[index]);
      },
    ),
    delete: jest.fn(
      ({
        where,
      }: {
        where: { orgId_valueId: { orgId: string; valueId: string } };
      }) => {
        const index = store.findIndex(
          (row) =>
            row.orgId === where.orgId_valueId.orgId &&
            row.valueId === where.orgId_valueId.valueId,
        );
        const [removed] = store.splice(index, 1);
        return Promise.resolve(removed);
      },
    ),
  };

  const prisma = {
    masterDataValue: delegate,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ masterDataValue: delegate }),
    ),
  };

  return { prisma, delegate, store };
}

function buildService(rows: ValueRecord[]) {
  const { prisma, delegate, store } = buildPrisma(rows);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new MasterDataService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, audit, delegate, store };
}

describe('MasterDataService.list', () => {
  it('returns SelectOption shape, so a form cannot tell it from an enum registry', async () => {
    const { service } = buildService([
      valueRecord({ code: 'MALE', label: 'Male', displayOrder: 10 }),
      valueRecord({
        valueId: 'v2',
        code: 'FEMALE',
        label: 'Female',
        displayOrder: 20,
      }),
    ]);

    const values = await service.list(actorContext(), { category: 'GENDER' });

    expect(values).toEqual([
      { value: 'MALE', label: 'Male' },
      { value: 'FEMALE', label: 'Female' },
    ]);
  });

  it('orders by displayOrder, then code as a tie-break', async () => {
    const { service } = buildService([
      valueRecord({ valueId: 'v1', code: 'ZEBRA', displayOrder: 0 }),
      valueRecord({ valueId: 'v2', code: 'ALPHA', displayOrder: 0 }),
      valueRecord({ valueId: 'v3', code: 'FIRST', displayOrder: -0 }),
    ]);

    const values = await service.list(actorContext(), { category: 'GENDER' });

    // All share displayOrder 0 — the state bulk-seeded data is in — so the code
    // tie-break is what keeps the order stable instead of planner-dependent.
    expect(values.map((v) => v.value)).toEqual(['ALPHA', 'FIRST', 'ZEBRA']);
  });

  it('marks an inactive value disabled rather than hiding it', async () => {
    const { service } = buildService([
      valueRecord({ code: 'RETIRED', status: 'INACTIVE' }),
    ]);

    const values = await service.list(actorContext(), { category: 'GENDER' });

    // Visible to the admin screen, but never selectable.
    expect(values[0]).toEqual({
      value: 'RETIRED',
      label: 'Male',
      disabled: true,
    });
  });

  it('filters to active values when a form asks', async () => {
    const { service, delegate } = buildService([
      valueRecord({ code: 'LIVE', status: 'ACTIVE' }),
      valueRecord({ valueId: 'v2', code: 'RETIRED', status: 'INACTIVE' }),
    ]);

    const values = await service.list(actorContext(), {
      category: 'GENDER',
      activeOnly: true,
    });

    expect(values.map((v) => v.value)).toEqual(['LIVE']);
    expect(delegate.findMany).toHaveBeenCalledWith(
      containing({ where: containing({ status: 'ACTIVE' }) }),
    );
  });

  it('never returns another organization values', async () => {
    const { service } = buildService([
      valueRecord({ orgId: OTHER_ORG_ID, code: 'THEIRS' }),
    ]);

    const values = await service.list(actorContext(), { category: 'GENDER' });

    expect(values).toEqual([]);
  });
});

describe('MasterDataService.create', () => {
  it('records the value and an audit row', async () => {
    const { service, audit } = buildService([]);

    const created = await service.create(
      actorContext(),
      validCreateDto(),
      META,
    );

    expect(created.code).toBe('NONBINARY');
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        orgId: ORG_ID,
        action: AuditAction.MASTER_DATA_VALUE_CREATED,
        entityType: 'MASTER_DATA_VALUE',
      }),
      expect.anything(),
    );
  });

  it('never lets a caller claim isSystem', async () => {
    const { service, delegate } = buildService([]);

    await service.create(
      actorContext(),
      // Even if the field slips past `forbidNonWhitelisted`, the service pins it.
      validCreateDto({ isSystem: true } as Partial<CreateMasterDataValueDto>),
      META,
    );

    expect(delegate.create).toHaveBeenCalledWith(
      containing({ data: containing({ isSystem: false }) }),
    );
  });

  it('translates a duplicate code into a 409, not a 500', async () => {
    const { service } = buildService([
      valueRecord({ category: 'GENDER', code: 'MALE' }),
    ]);

    // An untranslated P2002 surfaces as a 500 that reads like an outage rather
    // than the correctable input it is.
    await expect(
      service.create(actorContext(), validCreateDto({ code: 'MALE' }), META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same code in a different category', async () => {
    const { service } = buildService([
      valueRecord({ category: 'GENDER', code: 'OTHER' }),
    ]);

    // The uniqueness is (org, category, code) — "OTHER" is a perfectly good
    // value in more than one list.
    const created = await service.create(
      actorContext(),
      validCreateDto({ category: 'LOAN_PURPOSE', code: 'OTHER' }),
      META,
    );

    expect(created.code).toBe('OTHER');
  });
});

describe('MasterDataService.update', () => {
  it('relabels a value and audits the before and after', async () => {
    const { service, audit } = buildService([valueRecord()]);

    const updated = await service.update(
      actorContext(),
      VALUE_ID,
      { label: 'Male (updated)' },
      META,
    );

    expect(updated.label).toBe('Male (updated)');
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.MASTER_DATA_VALUE_UPDATED,
        oldData: containing({ label: 'Male' }),
        newData: containing({ label: 'Male (updated)' }),
      }),
      expect.anything(),
    );
  });

  it('deactivates a system value — retiring one is always allowed', async () => {
    const { service } = buildService([
      valueRecord({ valueId: SYSTEM_VALUE_ID, isSystem: true }),
    ]);

    const updated = await service.update(
      actorContext(),
      SYSTEM_VALUE_ID,
      { status: 'INACTIVE' },
      META,
    );

    expect(updated.status).toBe('INACTIVE');
  });

  it('refuses to reach another organization value', async () => {
    const { service } = buildService([
      valueRecord({ orgId: OTHER_ORG_ID, valueId: VALUE_ID }),
    ]);

    // A 404 rather than a 403: confirming the row exists would let a caller
    // enumerate another tenant's configuration.
    await expect(
      service.update(actorContext(), VALUE_ID, { label: 'x' }, META),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MasterDataService.remove', () => {
  it('deletes an admin-added value', async () => {
    const { service, store, audit } = buildService([
      valueRecord({ isSystem: false }),
    ]);

    const result = await service.remove(actorContext(), VALUE_ID, META);

    expect(result).toEqual({ valueId: VALUE_ID, deleted: true });
    expect(store).toHaveLength(0);
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.MASTER_DATA_VALUE_DELETED }),
      expect.anything(),
    );
  });

  it('refuses to delete a seeded value that business logic reads', async () => {
    const { service, store, audit } = buildService([
      valueRecord({
        valueId: SYSTEM_VALUE_ID,
        category: 'DOCUMENT_TYPE',
        code: 'ID',
        isSystem: true,
      }),
    ]);

    // Deleting `ID` would not fail loudly — the KYC completeness check would
    // simply stop requiring an identity document.
    await expect(
      service.remove(actorContext(), SYSTEM_VALUE_ID, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(store).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.MASTER_DATA_SYSTEM_VALUE_DELETE_REFUSED,
      }),
    );
  });

  it('points the caller at deactivation instead', async () => {
    const { service } = buildService([
      valueRecord({ valueId: SYSTEM_VALUE_ID, isSystem: true }),
    ]);

    await expect(
      service.remove(actorContext(), SYSTEM_VALUE_ID, META),
    ).rejects.toThrow(/Inactive/);
  });

  it('404s on an unknown value', async () => {
    const { service } = buildService([valueRecord()]);

    await expect(
      service.remove(actorContext(), UNKNOWN_VALUE_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never reaches across a tenant boundary', async () => {
    const { service, store } = buildService([
      valueRecord({ orgId: OTHER_ORG_ID, valueId: VALUE_ID }),
    ]);

    await expect(
      service.remove(actorContext(), VALUE_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(store).toHaveLength(1);
  });
});
