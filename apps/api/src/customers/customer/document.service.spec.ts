import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerService } from './customer.service';
import { DocumentService } from './document.service';
import type { FileStorage } from '../storage/file-storage';

/**
 * KYC document storage and review (Module 04, Scenarios 6, 11, 12, 32).
 *
 * What is actually being protected here is the bytes, not the row.
 *
 * **Type is decided by content.** A file claiming to be a JPEG must be rejected
 * if its signature says otherwise (Q-CUST-16). Trusting the client's header or
 * the filename would let an HTML document be stored as `id-proof.jpg` and later
 * handed back to a browser.
 *
 * **A replacement never overwrites.** Scenario 11 requires the previous version
 * to remain auditable, so an upload of an existing type inserts a new row and
 * marks the old one superseded rather than editing it.
 *
 * **A failed write leaves no orphan.** If the row does not land, the bytes must
 * not stay on disk — an unreferenced file in a directory of regulated personal
 * data is one no retention policy will ever find.
 *
 * **Every read is audited.** For KYC documents, who looked is itself the record,
 * which is the whole reason files are streamed through the API.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const UNKNOWN_ID = '55555555-5555-5555-5555-555555555555';

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
    permissions: ['customers.documents.upload'],
    ...overrides,
  };
}

/** Real signatures — the point of the sniffer is that these are what matter. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');
/** A valid HTML file. Nothing about it is an accepted KYC document. */
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'latin1');

/**
 * `expect.objectContaining` and `expect.stringContaining` are typed `any`,
 * which trips `no-unsafe-assignment` as soon as either is nested inside an
 * object literal. Narrowing them once here keeps the assertions below both
 * readable and type-safe — the same helper `branch.service.spec.ts` introduced
 * for Module 02.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(options: { existing?: Record<string, unknown> | null } = {}) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const rows = new Map<string, Record<string, unknown>>();

  const docRow = (over: Record<string, unknown> = {}) => ({
    orgId: ORG_ID,
    documentId: DOCUMENT_ID,
    customerId: CUSTOMER_ID,
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
    customerDocument: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('customerDocument.findMany must be tenant-filtered');
        }
        return Promise.resolve([...rows.values()]);
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('customerDocument.findFirst must be tenant-filtered');
        }
        // Without customerId in the where, a document id from another customer
        // would resolve — Scenario 32's direct-access attempt.
        if (args.where.customerId === undefined) {
          throw new Error(
            'customerDocument.findFirst must be scoped to the customer',
          );
        }
        if (args.where.documentId !== undefined) {
          return Promise.resolve(
            args.where.documentId === DOCUMENT_ID ? docRow() : null,
          );
        }
        return Promise.resolve(options.existing ?? null);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error(
            'customerDocument.create must carry the caller orgId',
          );
        }
        const created = docRow(args.data);
        rows.set(String(created.documentId), created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const key = args.where.orgId_documentId as { orgId: string };
          if (key.orgId !== ORG_ID) {
            throw new Error('customerDocument.update must be tenant-filtered');
          }
          return Promise.resolve(docRow(args.data));
        },
      ),
    },
  };

  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  const customersMocks = {
    findInScope: jest.fn().mockResolvedValue({ customerId: CUSTOMER_ID }),
  };
  const customers = customersMocks as unknown as CustomerService;

  const storageMocks = {
    save: jest.fn().mockResolvedValue({
      fileRef: `${ORG_ID}/${CUSTOMER_ID}/stored.jpg`,
      size: 6,
      checksum: 'abc123',
    }),
    read: jest.fn().mockResolvedValue({ pipe: jest.fn() }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const storage = storageMocks as unknown as FileStorage;

  const config = {
    get: jest.fn(() => 5 * 1024 * 1024),
  } as unknown as ConfigService;

  const service = new DocumentService(
    prisma,
    audit as unknown as AuditService,
    customers,
    config,
    storage,
  );

  return { service, prisma, audit, customersMocks, storageMocks, client };
}

describe('DocumentService.upload', () => {
  const dto = { documentType: 'ID' as const };

  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['PDF', PDF, 'application/pdf'],
  ])(
    'accepts a %s and stores the sniffed type',
    async (_label, buffer, mime) => {
      const { service, storageMocks } = build();
      const created = await service.upload(
        actor(),
        CUSTOMER_ID,
        dto,
        { buffer, originalname: 'doc' },
        META,
      );

      expect(jest.mocked(created).mimeType).toBe(mime);
      expect(storageMocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: mime }),
      );
    },
  );

  // Q-CUST-16 — the header and the filename are assertions, not evidence.
  it('rejects a file whose bytes are not an accepted type', async () => {
    const { service } = build();

    await expect(
      service.upload(
        actor(),
        CUSTOMER_ID,
        dto,
        { buffer: HTML, originalname: 'id-proof.jpg' },
        META,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('never writes a rejected file to storage', async () => {
    const { service, storageMocks } = build();

    await service
      .upload(
        actor(),
        CUSTOMER_ID,
        dto,
        { buffer: HTML, originalname: 'id-proof.jpg' },
        META,
      )
      .catch(() => {});

    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('audits a rejected upload', async () => {
    const { service, audit } = build();

    await service
      .upload(actor(), CUSTOMER_ID, dto, { buffer: HTML }, META)
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DOCUMENT_REJECTED_UPLOAD,
        metadata: containing({ reason: 'UNSUPPORTED_TYPE' }),
      }),
    );
  });

  it('rejects an empty upload', async () => {
    const { service } = build();

    await expect(
      service.upload(actor(), CUSTOMER_ID, dto, undefined, META),
    ).rejects.toThrow(/Select a file/);
  });

  it('rejects a file over the size limit', async () => {
    const { service } = build();
    const huge = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]);

    await expect(
      service.upload(actor(), CUSTOMER_ID, dto, { buffer: huge }, META),
    ).rejects.toThrow(/too large/);
  });

  it('stores a first upload at version 1', async () => {
    const { service } = build();
    const created = await service.upload(
      actor(),
      CUSTOMER_ID,
      dto,
      { buffer: JPEG },
      META,
    );

    expect(jest.mocked(created).version).toBe(1);
  });

  // Scenario 11 — the previous version stays auditable.
  it('supersedes the previous version rather than overwriting it', async () => {
    const { service, client } = build({
      existing: {
        documentId: 'old-doc',
        version: 1,
        documentType: 'ID',
      },
    });

    const created = await service.upload(
      actor(),
      CUSTOMER_ID,
      dto,
      { buffer: JPEG },
      META,
    );

    expect(jest.mocked(created).version).toBe(2);
    expect(client.customerDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ supersededAt: expect.any(Date) }),
      }),
    );
  });

  it('audits the superseded version', async () => {
    const { service, audit } = build({
      existing: { documentId: 'old-doc', version: 1, documentType: 'ID' },
    });

    await service.upload(actor(), CUSTOMER_ID, dto, { buffer: JPEG }, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DOCUMENT_SUPERSEDED,
      }),
      expect.anything(),
    );
  });

  // A replacement must re-block approval, or swapping the file underneath a
  // verified document would silently keep the pack approvable.
  it('stores a replacement as unverified', async () => {
    const { service } = build({
      existing: {
        documentId: 'old-doc',
        version: 1,
        documentType: 'ID',
        verificationStatus: 'VERIFIED',
      },
    });

    const created = await service.upload(
      actor(),
      CUSTOMER_ID,
      dto,
      { buffer: JPEG },
      META,
    );

    expect(jest.mocked(created).verificationStatus).toBe('PENDING');
  });

  it('removes the stored bytes when the row fails to persist', async () => {
    const { service, prisma, storageMocks } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await expect(
      service.upload(actor(), CUSTOMER_ID, dto, { buffer: JPEG }, META),
    ).rejects.toThrow('connection lost');

    expect(storageMocks.remove).toHaveBeenCalledWith(
      `${ORG_ID}/${CUSTOMER_ID}/stored.jpg`,
    );
  });

  it('resolves the customer through the shared scope check first', async () => {
    const { service, customersMocks } = build();
    await service.upload(actor(), CUSTOMER_ID, dto, { buffer: JPEG }, META);

    expect(customersMocks.findInScope).toHaveBeenCalled();
  });

  it('records the checksum of the stored bytes', async () => {
    const { service, audit } = build();
    await service.upload(actor(), CUSTOMER_ID, dto, { buffer: JPEG }, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DOCUMENT_UPLOADED,
        metadata: containing({ checksum: 'abc123' }),
      }),
      expect.anything(),
    );
  });
});

describe('DocumentService.verify', () => {
  it('marks a document verified', async () => {
    const { service } = build();
    const updated = await service.verify(
      actor(),
      CUSTOMER_ID,
      DOCUMENT_ID,
      { status: 'VERIFIED' },
      META,
    );

    expect(jest.mocked(updated).verificationStatus).toBe('VERIFIED');
  });

  it('records the reason on a rejection', async () => {
    const { service } = build();
    const updated = await service.verify(
      actor(),
      CUSTOMER_ID,
      DOCUMENT_ID,
      { status: 'REJECTED', reason: 'Illegible scan' },
      META,
    );

    expect(jest.mocked(updated).verificationReason).toBe('Illegible scan');
  });

  it.each([
    ['VERIFIED', AuditAction.CUSTOMER_DOCUMENT_VERIFIED],
    ['REJECTED', AuditAction.CUSTOMER_DOCUMENT_REJECTED],
  ])('audits a %s decision under its own action', async (status, action) => {
    const { service, audit } = build();
    await service.verify(
      actor(),
      CUSTOMER_ID,
      DOCUMENT_ID,
      { status: status as 'VERIFIED' | 'REJECTED', reason: 'A reason' },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action }),
      expect.anything(),
    );
  });

  it('refuses a document that does not belong to the customer', async () => {
    const { service } = build();

    await expect(
      service.verify(
        actor(),
        CUSTOMER_ID,
        UNKNOWN_ID,
        { status: 'VERIFIED' },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('DocumentService.download', () => {
  // Scenario 12 — the read itself is the record.
  it('audits every download', async () => {
    const { service, audit } = build();
    await service.download(actor(), CUSTOMER_ID, DOCUMENT_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DOCUMENT_DOWNLOADED,
      }),
    );
  });

  it('returns the stored type rather than guessing', async () => {
    const { service } = build();
    const file = await service.download(
      actor(),
      CUSTOMER_ID,
      DOCUMENT_ID,
      META,
    );

    expect(jest.mocked(file).mimeType).toBe('image/jpeg');
  });

  // Scenario 32 — the customer scope check runs before the document is read.
  it('resolves the customer before opening the file', async () => {
    const { service, customersMocks, storageMocks } = build();
    customersMocks.findInScope.mockRejectedValueOnce(
      new NotFoundException('Customer not found'),
    );

    await expect(
      service.download(actor(), CUSTOMER_ID, DOCUMENT_ID, META),
    ).rejects.toThrow(NotFoundException);

    expect(storageMocks.read).not.toHaveBeenCalled();
  });

  it('refuses a document id belonging to a different customer', async () => {
    const { service } = build();

    await expect(
      service.download(actor(), CUSTOMER_ID, UNKNOWN_ID, META),
    ).rejects.toThrow(NotFoundException);
  });

  it('audits a refused document access', async () => {
    const { service, audit } = build();

    await service
      .download(actor(), CUSTOMER_ID, UNKNOWN_ID, META)
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DOCUMENT_ACCESS_DENIED,
      }),
    );
  });
});
