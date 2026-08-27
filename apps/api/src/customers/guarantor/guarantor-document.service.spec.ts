import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerService } from '../customer/customer.service';
import { GuarantorDocumentService } from './guarantor-document.service';

/**
 * Guarantor KYC documents (Module 05, Scenarios 20, 21, 45).
 *
 * The storage guarantees are the borrower pack's, re-asserted here because they
 * are enforced by a second implementation that could drift: content-sniffed
 * types, supersede-on-replace, no orphaned bytes after a failed write, and an
 * audit entry for every read.
 *
 * Two properties are specific to guarantors:
 *
 * **The required set excludes PHOTO** (Q-GUAR-9). Demanding one would block
 * approval on a document the source never says is needed.
 *
 * **Files are filed under the customer**, not the guarantor, so a per-customer
 * retention sweep reaches the whole relationship's paperwork in one directory.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const GUARANTOR_ID = '44444444-4444-4444-4444-444444444444';
const DOCUMENT_ID = '55555555-5555-5555-5555-555555555555';
const UNKNOWN_ID = '66666666-6666-6666-6666-666666666666';

const META: RequestMeta = {
  requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ipAddress: '203.0.113.11',
  userAgent: 'jest',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: null,
    roles: ['BRANCH_ADMIN'],
    permissions: ['customers.guarantors.documents.upload'],
    ...overrides,
  };
}

/** Real signatures — the point of the sniffer is that these are what matter. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
/** A valid HTML file. Nothing about it is an accepted KYC document. */
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'latin1');

function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(
  options: {
    existing?: Record<string, unknown> | null;
    verified?: Record<string, unknown>[];
    guarantorMissing?: boolean;
  } = {},
) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const docRow = (over: Record<string, unknown> = {}) => ({
    orgId: ORG_ID,
    documentId: DOCUMENT_ID,
    guarantorId: GUARANTOR_ID,
    documentType: 'ID',
    documentNumber: null,
    fileRef: `${ORG_ID}/${CUSTOMER_ID}/stored.jpg`,
    fileName: 'id.jpg',
    mimeType: 'image/jpeg',
    fileSize: 6,
    version: 1,
    supersededAt: null,
    verificationStatus: 'PENDING',
    verificationReason: null,
    verifiedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  });

  const client = {
    guarantor: {
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.customerId === undefined) {
          throw new Error('guarantor lookup must be scoped to the customer');
        }
        return Promise.resolve(
          options.guarantorMissing
            ? null
            : {
                orgId: ORG_ID,
                guarantorId: GUARANTOR_ID,
                customerId: CUSTOMER_ID,
              },
        );
      }),
    },
    guarantorDocument: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('guarantorDocument.findMany must be tenant-filtered');
        }
        // The completeness check asks only for current verified rows.
        if (args.where.verificationStatus === 'VERIFIED') {
          return Promise.resolve(options.verified ?? []);
        }
        return Promise.resolve([docRow()]);
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error(
            'guarantorDocument.findFirst must be tenant-filtered',
          );
        }
        // Without guarantorId in the where, a document id from another
        // guarantor would resolve — the direct-access attempt.
        if (args.where.guarantorId === undefined) {
          throw new Error(
            'guarantorDocument.findFirst must be scoped to the guarantor',
          );
        }
        if (args.where.documentId !== undefined) {
          return Promise.resolve(
            args.where.documentId === DOCUMENT_ID ? docRow() : null,
          );
        }
        return Promise.resolve(options.existing ?? null);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(docRow(args.data)),
      ),
      update: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(docRow(args.data)),
      ),
    },
  };

  // Held separately for the same reason the delegates are: reading
  // `prisma.$transaction` off a `PrismaService`-typed object trips
  // `unbound-method` when a test needs to override it.
  const transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn(client),
  );

  const prisma = {
    ...client,
    $transaction: transaction,
  } as unknown as PrismaService;

  const customersMocks = {
    findInScope: jest.fn().mockResolvedValue({ customerId: CUSTOMER_ID }),
  };

  const storageMocks = {
    save: jest.fn().mockResolvedValue({
      fileRef: `${ORG_ID}/${CUSTOMER_ID}/stored.jpg`,
      size: 6,
      checksum: 'abc',
    }),
    read: jest.fn().mockResolvedValue({ pipe: jest.fn() }),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  const config = {
    get: jest.fn(() => 5 * 1024 * 1024),
  } as unknown as ConfigService;

  const service = new GuarantorDocumentService(
    prisma,
    audit as unknown as AuditService,
    customersMocks as unknown as CustomerService,
    config,
    storageMocks,
  );

  return { service, audit, client, customersMocks, storageMocks, transaction };
}

describe('GuarantorDocumentService.upload', () => {
  it('stores a document whose signature is accepted', async () => {
    const { service, client } = build();

    await service.upload(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { documentType: 'ID' },
      { buffer: JPEG, originalname: 'id.jpg' },
      META,
    );

    expect(client.guarantorDocument.create).toHaveBeenCalled();
  });

  // Rule 19 — uploading is not verifying, even when replacing a verified file.
  it('always lands unverified', async () => {
    const { service, client } = build();

    await service.upload(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { documentType: 'ID' },
      { buffer: JPEG },
      META,
    );

    expect(client.guarantorDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ verificationStatus: 'PENDING' }),
      }),
    );
  });

  it('refuses a file whose content is not an accepted type', async () => {
    const { service } = build();

    await expect(
      service.upload(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { documentType: 'ID' },
        { buffer: HTML, originalname: 'id.jpg' },
        META,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('audits a rejected upload', async () => {
    const { service, audit } = build();

    await expect(
      service.upload(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { documentType: 'ID' },
        { buffer: HTML },
        META,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_REJECTED_UPLOAD,
      }),
    );
  });

  it('refuses an empty upload', async () => {
    const { service } = build();

    await expect(
      service.upload(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { documentType: 'ID' },
        undefined,
        META,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // Files live under the customer so a per-customer retention sweep is one
  // directory operation, not two.
  it('files the bytes under the owning customer', async () => {
    const { service, storageMocks } = build();

    await service.upload(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { documentType: 'ID' },
      { buffer: JPEG },
      META,
    );

    expect(storageMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: CUSTOMER_ID }),
    );
  });

  it('marks the previous version superseded rather than overwriting it', async () => {
    const { service, client } = build({
      existing: {
        orgId: ORG_ID,
        documentId: DOCUMENT_ID,
        guarantorId: GUARANTOR_ID,
        documentType: 'ID',
        version: 1,
      },
    });

    await service.upload(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { documentType: 'ID' },
      { buffer: JPEG },
      META,
    );

    expect(client.guarantorDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ supersededAt: expect.any(Date) as unknown }),
      }),
    );
    expect(client.guarantorDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: containing({ version: 2 }) }),
    );
  });

  /**
   * Scenario 45 — a storage write that is not followed by a row must not leave
   * the bytes behind. An unreferenced file in a directory of regulated personal
   * data is one no retention policy will ever find.
   */
  it('removes the stored file when the row does not land', async () => {
    const { service, storageMocks, transaction } = build();
    transaction.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      service.upload(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { documentType: 'ID' },
        { buffer: JPEG },
        META,
      ),
    ).rejects.toThrow('write failed');

    expect(storageMocks.remove).toHaveBeenCalledWith(
      `${ORG_ID}/${CUSTOMER_ID}/stored.jpg`,
    );
  });

  it('refuses a guarantor outside the caller scope', async () => {
    const { service } = build({ guarantorMissing: true });

    await expect(
      service.upload(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { documentType: 'ID' },
        { buffer: JPEG },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('GuarantorDocumentService.verify', () => {
  it('records the decision', async () => {
    const { service, client } = build();

    await service.verify(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      DOCUMENT_ID,
      { status: 'VERIFIED' },
      META,
    );

    expect(client.guarantorDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ verificationStatus: 'VERIFIED' }),
      }),
    );
  });

  it('audits a rejection with its reason', async () => {
    const { service, audit } = build();

    await service.verify(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      DOCUMENT_ID,
      { status: 'REJECTED', reason: 'Illegible' },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_REJECTED,
        metadata: containing({ reason: 'Illegible' }),
      }),
      expect.anything(),
    );
  });

  it('refuses a document belonging to another guarantor', async () => {
    const { service } = build();

    await expect(
      service.verify(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        UNKNOWN_ID,
        { status: 'VERIFIED' },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('audits a denied document lookup', async () => {
    const { service, audit } = build();

    await expect(
      service.verify(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        UNKNOWN_ID,
        { status: 'VERIFIED' },
        META,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_ACCESS_DENIED,
      }),
    );
  });
});

describe('GuarantorDocumentService.download', () => {
  // Who looked is itself part of the record for third-party personal data.
  it('audits the read before streaming', async () => {
    const { service, audit } = build();

    await service.download(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      DOCUMENT_ID,
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_DOWNLOADED,
      }),
    );
  });
});

/**
 * Scenario 21 — what must be verified before KYC can be approved.
 *
 * The required set is ID + ADDRESS. PHOTO is accepted but never demanded
 * (Q-GUAR-9): the source never says a guarantor photo is required, and
 * requiring one would block every approval on a document nobody agreed to
 * collect.
 */
describe('GuarantorDocumentService.missingRequirements', () => {
  it('reports both required types when nothing is verified', async () => {
    const { service } = build({ verified: [] });

    await expect(
      service.missingRequirements(ORG_ID, GUARANTOR_ID),
    ).resolves.toEqual(['ID', 'ADDRESS']);
  });

  it('reports what is still outstanding', async () => {
    const { service } = build({ verified: [{ documentType: 'ID' }] });

    await expect(
      service.missingRequirements(ORG_ID, GUARANTOR_ID),
    ).resolves.toEqual(['ADDRESS']);
  });

  it('is satisfied by ID and ADDRESS alone', async () => {
    const { service } = build({
      verified: [{ documentType: 'ID' }, { documentType: 'ADDRESS' }],
    });

    await expect(
      service.missingRequirements(ORG_ID, GUARANTOR_ID),
    ).resolves.toEqual([]);
  });

  // The distinguishing rule: a missing photo must never hold up an approval.
  it('does not require a photo', async () => {
    const { service } = build({
      verified: [{ documentType: 'ID' }, { documentType: 'ADDRESS' }],
    });

    const missing = await service.missingRequirements(ORG_ID, GUARANTOR_ID);

    expect(missing).not.toContain('PHOTO');
  });

  // Uploading is not verifying, so only VERIFIED rows count — asserted by the
  // mock, which returns the verified set only for that filter.
  it('counts only current verified documents', async () => {
    const { service, client } = build({ verified: [] });

    await service.missingRequirements(ORG_ID, GUARANTOR_ID);

    expect(client.guarantorDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: containing({
          verificationStatus: 'VERIFIED',
          supersededAt: null,
        }),
      }),
    );
  });
});
