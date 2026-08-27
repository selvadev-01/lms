import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { FileStorage } from '../../customers/storage/file-storage';
import type { PrismaService } from '../../prisma/prisma.service';
import { LoanApplicationDocumentService } from './loan-application-document.service';
import type { LoanApplicationService } from './loan-application.service';

/**
 * Loan application supporting documents (Scenarios 17-20).
 *
 * A deliberate near-copy of `document.service.spec.ts`, because the service it
 * covers is a deliberate near-copy of `DocumentService`. The storage rules are
 * the same and are protected here for the same reasons — type decided by
 * content, a replacement that never overwrites, no orphaned bytes after a failed
 * write, and every read audited.
 *
 * Three rules are tested here that the customer and guarantor twins have no
 * equivalent for, because they belong to the application lifecycle rather than
 * to file storage:
 *
 * **A decided application's evidence is fixed.** Once an application is APPROVED
 * or REJECTED, no upload may land. Otherwise the pack a decision rested on could
 * change underneath it, and the audit trail would describe a review of documents
 * that are no longer there.
 *
 * **A rejection carries a reason.** Checked in the service rather than with
 * `@ValidateIf` in the DTO: on an otherwise optional field that decorator skips
 * `@IsNotEmpty`, so a missing reason would pass validation entirely.
 *
 * **The filename cannot inject a header.** It reaches the client inside
 * `Content-Disposition`, so quotes and line breaks in a user-supplied name are a
 * response-splitting vector rather than a cosmetic problem.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const APPLICATION_ID = '33333333-3333-3333-3333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_DOCUMENT_ID = '55555555-5555-5555-5555-555555555555';

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
    permissions: ['loans.applications.documents.upload'],
    ...overrides,
  };
}

/** Real signatures — the point of the sniffer is that these are what matter. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');
/** A valid HTML file. Nothing about it is an accepted supporting document. */
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'latin1');

/**
 * `expect.objectContaining` is typed `any`, which trips `no-unsafe-assignment`
 * as soon as it is nested inside an object literal. Narrowing it once here keeps
 * the assertions below both readable and type-safe.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(
  options: {
    existing?: Record<string, unknown> | null;
    status?: string;
    row?: Record<string, unknown>;
  } = {},
) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const rows = new Map<string, Record<string, unknown>>();

  const docRow = (over: Record<string, unknown> = {}) => ({
    orgId: ORG_ID,
    applicationDocumentId: DOCUMENT_ID,
    applicationId: APPLICATION_ID,
    documentType: 'ID',
    documentNumber: null,
    fileRef: `${ORG_ID}/${APPLICATION_ID}/stored.jpg`,
    fileName: 'id.jpg',
    mimeType: 'image/jpeg',
    fileSize: 6,
    version: 1,
    supersededAt: null,
    status: 'PENDING',
    verificationReason: null,
    verifiedAt: null,
    verifiedBy: null,
    uploadedBy: ACTOR_ID,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  });

  const client = {
    loanApplicationDocument: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error(
            'loanApplicationDocument.findMany must be tenant-filtered',
          );
        }
        return Promise.resolve([...rows.values()]);
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error(
            'loanApplicationDocument.findFirst must be tenant-filtered',
          );
        }
        // Without applicationId in the where, a document id from another
        // application would resolve — Scenario 20's direct-access attempt.
        if (args.where.applicationId === undefined) {
          throw new Error(
            'loanApplicationDocument.findFirst must be scoped to the application',
          );
        }
        if (args.where.applicationDocumentId !== undefined) {
          return Promise.resolve(
            args.where.applicationDocumentId === DOCUMENT_ID
              ? docRow(options.row ?? {})
              : null,
          );
        }
        return Promise.resolve(options.existing ?? null);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error(
            'loanApplicationDocument.create must carry the caller orgId',
          );
        }
        const created = docRow(args.data);
        rows.set(String(created.applicationDocumentId), created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const key = args.where.orgId_applicationDocumentId as {
            orgId: string;
          };
          if (key.orgId !== ORG_ID) {
            throw new Error(
              'loanApplicationDocument.update must be tenant-filtered',
            );
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

  const applicationMocks = {
    findInScope: jest.fn().mockResolvedValue({
      applicationId: APPLICATION_ID,
      status: options.status ?? 'DRAFT',
    }),
  };
  const applications = applicationMocks as unknown as LoanApplicationService;

  const storageMocks = {
    save: jest.fn().mockResolvedValue({
      fileRef: `${ORG_ID}/${APPLICATION_ID}/stored.jpg`,
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

  const service = new LoanApplicationDocumentService(
    prisma,
    audit as unknown as AuditService,
    applications,
    config,
    storage,
  );

  return { service, prisma, audit, applicationMocks, storageMocks, client };
}

describe('LoanApplicationDocumentService.upload', () => {
  const dto = { documentType: 'ID' as const };

  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['PDF', PDF, 'application/pdf'],
  ])('accepts a %s by its signature', async (_label, buffer, mimeType) => {
    const { service, storageMocks } = build();

    const summary = await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer, originalname: 'proof' },
      META,
    );

    expect(summary.mimeType).toBe(mimeType);
    expect(storageMocks.save).toHaveBeenCalledWith(
      containing({ mimeType, orgId: ORG_ID, ownerId: APPLICATION_ID }),
    );
  });

  it('rejects a file whose bytes are not an accepted type', async () => {
    const { service } = build();

    await expect(
      service.upload(
        actor(),
        APPLICATION_ID,
        dto,
        // The name and the extension both claim a JPEG. Only the bytes decide.
        { buffer: HTML, originalname: 'id-proof.jpg' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never writes a rejected file to storage', async () => {
    const { service, storageMocks } = build();

    await expect(
      service.upload(
        actor(),
        APPLICATION_ID,
        dto,
        { buffer: HTML, originalname: 'id-proof.jpg' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('audits a rejected upload', async () => {
    const { service, audit } = build();

    await expect(
      service.upload(
        actor(),
        APPLICATION_ID,
        dto,
        { buffer: HTML, originalname: 'id-proof.jpg' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_DOCUMENT_REJECTED_UPLOAD,
        metadata: containing({ reason: 'UNSUPPORTED_TYPE' }),
      }),
    );
  });

  it('rejects an empty upload', async () => {
    const { service, storageMocks } = build();

    await expect(
      service.upload(
        actor(),
        APPLICATION_ID,
        dto,
        { buffer: Buffer.alloc(0), originalname: 'empty.jpg' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit', async () => {
    const { service, storageMocks } = build();
    const oversize = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]);

    await expect(
      service.upload(
        actor(),
        APPLICATION_ID,
        dto,
        { buffer: oversize, originalname: 'big.jpg' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('stores a first upload at version 1', async () => {
    const { service } = build({ existing: null });

    const summary = await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer: JPEG, originalname: 'id.jpg' },
      META,
    );

    expect(summary.version).toBe(1);
  });

  it('supersedes the previous version rather than overwriting it', async () => {
    const existing = {
      applicationDocumentId: OTHER_DOCUMENT_ID,
      version: 1,
    };
    const { service, client } = build({ existing });

    const summary = await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer: JPEG, originalname: 'id-v2.jpg' },
      META,
    );

    // The old row is marked, not deleted: it is what an earlier review referred
    // to (Rule 91).
    expect(client.loanApplicationDocument.update).toHaveBeenCalledWith(
      containing({
        data: containing({ supersededAt: expect.any(Date) as unknown }),
      }),
    );
    expect(summary.version).toBe(2);
  });

  it('audits the superseded version', async () => {
    const { service, audit } = build({
      existing: { applicationDocumentId: OTHER_DOCUMENT_ID, version: 1 },
    });

    await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer: JPEG, originalname: 'id-v2.jpg' },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_DOCUMENT_SUPERSEDED,
        entityId: OTHER_DOCUMENT_ID,
      }),
      expect.anything(),
    );
  });

  it('stores a replacement as unverified', async () => {
    const { service, client } = build({
      existing: {
        applicationDocumentId: OTHER_DOCUMENT_ID,
        version: 1,
        status: 'VERIFIED',
      },
    });

    await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer: JPEG, originalname: 'id-v2.jpg' },
      META,
    );

    // Otherwise a rejected pack could be re-approved by swapping the file
    // underneath it.
    expect(client.loanApplicationDocument.create).toHaveBeenCalledWith(
      containing({ data: containing({ status: 'PENDING' }) }),
    );
  });

  it('removes the stored bytes when the row fails to persist', async () => {
    const { service, prisma, storageMocks } = build();
    (prisma.$transaction as unknown as jest.Mock).mockRejectedValueOnce(
      new Error('write failed'),
    );

    await expect(
      service.upload(
        actor(),
        APPLICATION_ID,
        dto,
        { buffer: JPEG, originalname: 'id.jpg' },
        META,
      ),
    ).rejects.toThrow('write failed');

    // Scenario 19: an unreferenced file in a directory of regulated personal
    // data is one no retention policy will ever find.
    expect(storageMocks.remove).toHaveBeenCalledWith(
      `${ORG_ID}/${APPLICATION_ID}/stored.jpg`,
    );
  });

  it('resolves the application through the shared scope check first', async () => {
    const { service, applicationMocks } = build();

    await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer: JPEG, originalname: 'id.jpg' },
      META,
    );

    expect(applicationMocks.findInScope).toHaveBeenCalledWith(
      containing({ orgId: ORG_ID }),
      APPLICATION_ID,
      META,
    );
  });

  it('records the checksum of the stored bytes', async () => {
    const { service, audit } = build();

    await service.upload(
      actor(),
      APPLICATION_ID,
      dto,
      { buffer: JPEG, originalname: 'id.jpg' },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_DOCUMENT_UPLOADED,
        metadata: containing({ checksum: 'abc123' }),
      }),
      expect.anything(),
    );
  });

  it.each(['APPROVED', 'REJECTED'])(
    'refuses an upload to an application that is %s',
    async (status) => {
      const { service, storageMocks } = build({ status });

      // A decided application's evidence is fixed: allowing an upload would let
      // the pack the decision rested on change underneath it.
      await expect(
        service.upload(
          actor(),
          APPLICATION_ID,
          dto,
          { buffer: JPEG, originalname: 'id.jpg' },
          META,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(storageMocks.save).not.toHaveBeenCalled();
    },
  );

  it.each(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'])(
    'allows an upload while the application is %s',
    async (status) => {
      const { service } = build({ status });

      await expect(
        service.upload(
          actor(),
          APPLICATION_ID,
          dto,
          { buffer: JPEG, originalname: 'id.jpg' },
          META,
        ),
      ).resolves.toBeDefined();
    },
  );
});

describe('LoanApplicationDocumentService.verify', () => {
  it('marks a document verified', async () => {
    const { service } = build();

    const summary = await service.verify(
      actor(),
      APPLICATION_ID,
      DOCUMENT_ID,
      { status: 'VERIFIED' },
      META,
    );

    expect(summary.status).toBe('VERIFIED');
  });

  it('records the reason on a rejection', async () => {
    const { service } = build();

    const summary = await service.verify(
      actor(),
      APPLICATION_ID,
      DOCUMENT_ID,
      { status: 'REJECTED', reason: 'Illegible scan' },
      META,
    );

    expect(summary.status).toBe('REJECTED');
    expect(summary.verificationReason).toBe('Illegible scan');
  });

  it.each([undefined, '', '   '])(
    'refuses a rejection whose reason is %p',
    async (reason) => {
      const { service } = build();

      // `@ValidateIf` on an optional field silently skips `@IsNotEmpty`, so this
      // has to be a service check rather than a DTO decorator.
      await expect(
        service.verify(
          actor(),
          APPLICATION_ID,
          DOCUMENT_ID,
          { status: 'REJECTED', reason },
          META,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('refuses a document that does not belong to the application', async () => {
    const { service } = build();

    await expect(
      service.verify(
        actor(),
        APPLICATION_ID,
        OTHER_DOCUMENT_ID,
        { status: 'VERIFIED' },
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LoanApplicationDocumentService.download', () => {
  it('audits every download', async () => {
    const { service, audit } = build();

    await service.download(actor(), APPLICATION_ID, DOCUMENT_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_DOCUMENT_DOWNLOADED,
        entityId: DOCUMENT_ID,
      }),
    );
  });

  it('returns the stored type rather than guessing', async () => {
    const { service } = build({ row: { mimeType: 'application/pdf' } });

    const file = await service.download(
      actor(),
      APPLICATION_ID,
      DOCUMENT_ID,
      META,
    );

    expect(file.mimeType).toBe('application/pdf');
  });

  it('falls back to a generic type when none was stored', async () => {
    const { service } = build({ row: { mimeType: null } });

    const file = await service.download(
      actor(),
      APPLICATION_ID,
      DOCUMENT_ID,
      META,
    );

    // Never re-sniffed on the way out: a byte pattern that looked like one thing
    // at upload must not become another thing at download.
    expect(file.mimeType).toBe('application/octet-stream');
  });

  it('names a file that was stored without one', async () => {
    const { service } = build({
      row: { fileName: null, documentType: 'INCOME', version: 3 },
    });

    const file = await service.download(
      actor(),
      APPLICATION_ID,
      DOCUMENT_ID,
      META,
    );

    expect(file.fileName).toBe('income-3');
  });

  it('resolves the application before opening the file', async () => {
    const { service, applicationMocks, storageMocks } = build();

    await service.download(actor(), APPLICATION_ID, DOCUMENT_ID, META);

    expect(applicationMocks.findInScope).toHaveBeenCalled();
    expect(storageMocks.read).toHaveBeenCalledWith(
      `${ORG_ID}/${APPLICATION_ID}/stored.jpg`,
    );
  });

  it('refuses a document id belonging to a different application', async () => {
    const { service, storageMocks } = build();

    await expect(
      service.download(actor(), APPLICATION_ID, OTHER_DOCUMENT_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(storageMocks.read).not.toHaveBeenCalled();
  });

  it('audits a refused document access', async () => {
    const { service, audit } = build();

    await expect(
      service.download(actor(), APPLICATION_ID, OTHER_DOCUMENT_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_DOCUMENT_ACCESS_DENIED,
        entityId: OTHER_DOCUMENT_ID,
      }),
    );
  });
});

describe('LoanApplicationDocumentService.list', () => {
  it('resolves the application before listing', async () => {
    const { service, applicationMocks } = build();

    await service.list(actor(), APPLICATION_ID, META);

    expect(applicationMocks.findInScope).toHaveBeenCalledWith(
      containing({ orgId: ORG_ID }),
      APPLICATION_ID,
      META,
    );
  });

  it('omits superseded versions', async () => {
    const { service, client } = build();

    await service.list(actor(), APPLICATION_ID, META);

    // A superseded row is retained for audit, but it is not the current pack and
    // must not count towards completeness.
    expect(client.loanApplicationDocument.findMany).toHaveBeenCalledWith(
      containing({ where: containing({ supersededAt: null }) }),
    );
  });
});
