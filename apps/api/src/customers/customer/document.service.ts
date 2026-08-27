import type { Readable } from 'node:stream';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CustomerDocumentSummary,
  DocumentVerificationStatus,
  KycDocumentType,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from './customer.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';
import { FILE_STORAGE, type FileStorage } from '../storage/file-storage';
import {
  ALLOWED_DOCUMENT_LABEL,
  sniffDocumentMimeType,
} from '../storage/sniff-mime';

export const CUSTOMERS_DOCUMENTS_UPLOAD_PERMISSION =
  'customers.documents.upload';
export const CUSTOMERS_DOCUMENTS_VERIFY_PERMISSION =
  'customers.documents.verify';
export const CUSTOMERS_DOCUMENTS_DOWNLOAD_PERMISSION =
  'customers.documents.download';

const NOT_REACHABLE = 'Document not found';

type DocumentRow = {
  orgId: string;
  documentId: string;
  customerId: string;
  documentType: string;
  documentNumber: string | null;
  fileRef: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  version: number;
  supersededAt: Date | null;
  verificationStatus: DocumentVerificationStatus;
  verificationReason: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
};

function toSummary(row: DocumentRow): CustomerDocumentSummary {
  return {
    documentId: row.documentId,
    customerId: row.customerId,
    documentType: row.documentType as KycDocumentType,
    documentNumber: row.documentNumber ?? undefined,
    fileName: row.fileName ?? undefined,
    mimeType: row.mimeType ?? undefined,
    fileSize: row.fileSize ?? undefined,
    version: row.version,
    supersededAt: row.supersededAt?.toISOString(),
    verificationStatus: row.verificationStatus,
    verificationReason: row.verificationReason ?? undefined,
    verifiedAt: row.verifiedAt?.toISOString(),
    uploadedAt: row.createdAt.toISOString(),
  };
}

/**
 * KYC document storage and review (Module 04, Scenarios 6, 11, 12, 32).
 *
 * Two rules shape this file, and both are about the bytes rather than the row.
 *
 * **Nothing is reachable by URL.** A stored file has no public path; the only
 * way to read one is {@link download}, which resolves the customer through
 * `CustomerService.findInScope` first. Scenario 32 asks that a document
 * belonging to a customer outside the caller's scope be refused on direct
 * access, and the way to guarantee that is for "direct access" not to exist.
 *
 * **A replacement never overwrites.** Uploading a second document of the same
 * type inserts a new row and marks the previous one superseded (Scenario 11), so
 * the version a reviewer saw when they made a decision is still there
 * afterwards. Overwriting would make the audit trail describe a file that no
 * longer exists.
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly maxBytes: number;

  /**
   * `@Inject(FILE_STORAGE)` sits last purely as a readability convention: the
   * type-inferred dependencies read as a group, and the one resolved by token
   * stands apart from them.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {
    this.maxBytes =
      this.config.get<number>('customers.maxDocumentBytes') ?? 5 * 1024 * 1024;
  }

  /** Lists the customer's documents, current versions first. */
  async list(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<CustomerDocumentSummary[]> {
    await this.customers.findInScope(actor, customerId, meta);

    const rows = await this.prisma.customerDocument.findMany({
      where: { orgId: actor.orgId, customerId },
      orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
    });

    return rows.map(toSummary);
  }

  /**
   * Stores an uploaded document (Scenarios 6, 11).
   *
   * The file is validated, then written to storage, then recorded — in that
   * order. A write that succeeds on disk but fails in the database is cleaned up
   * explicitly, because the alternative is an orphaned file in a directory of
   * regulated personal data that nothing knows about and no retention policy
   * will ever reach.
   */
  async upload(
    actor: AuthContext,
    customerId: string,
    dto: UploadDocumentDto,
    file: { buffer: Buffer; originalname?: string } | undefined,
    meta: RequestMeta,
  ): Promise<CustomerDocumentSummary> {
    await this.customers.findInScope(actor, customerId, meta);

    const buffer = file?.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new BadRequestException('Select a file to upload');
    }

    if (buffer.byteLength > this.maxBytes) {
      await this.recordUploadRejection(actor, customerId, meta, {
        reason: 'TOO_LARGE',
        size: buffer.byteLength,
      });
      throw new BadRequestException(
        `File is too large. The maximum size is ${Math.floor(
          this.maxBytes / (1024 * 1024),
        )} MB.`,
      );
    }

    // Q-CUST-16 — decided by content, never by the filename or the header the
    // client sent. A file named `id.jpg` that is actually HTML is refused here.
    const mimeType = sniffDocumentMimeType(buffer);
    if (!mimeType) {
      await this.recordUploadRejection(actor, customerId, meta, {
        reason: 'UNSUPPORTED_TYPE',
        claimedName: file?.originalname ?? null,
      });
      throw new BadRequestException(
        `Unsupported file type. Upload a ${ALLOWED_DOCUMENT_LABEL} file.`,
      );
    }

    const superseded = await this.prisma.customerDocument.findFirst({
      where: {
        orgId: actor.orgId,
        customerId,
        documentType: dto.documentType,
        supersededAt: null,
      },
      orderBy: { version: 'desc' },
    });

    const stored = await this.storage.save({
      orgId: actor.orgId,
      ownerId: customerId,
      buffer,
      mimeType,
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // The previous version is retained and marked, not deleted: it is what a
        // reviewer's earlier decision referred to (Scenario 11).
        if (superseded) {
          await tx.customerDocument.update({
            where: {
              orgId_documentId: {
                orgId: actor.orgId,
                documentId: superseded.documentId,
              },
            },
            data: { supersededAt: new Date() },
          });

          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.CUSTOMER_DOCUMENT_SUPERSEDED,
              entityType: 'CUSTOMER_DOCUMENT',
              entityId: superseded.documentId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                customerId,
                documentType: dto.documentType,
                version: superseded.version,
              },
            },
            tx,
          );
        }

        const row = await tx.customerDocument.create({
          data: {
            orgId: actor.orgId,
            customerId,
            documentType: dto.documentType,
            documentNumber: dto.documentNumber ?? null,
            fileRef: stored.fileRef,
            fileName: file?.originalname?.slice(0, 255) ?? null,
            mimeType,
            fileSize: stored.size,
            version: (superseded?.version ?? 0) + 1,
            uploadedBy: actor.userId,
            // A fresh upload is always unverified, even when it replaces a
            // verified document. Inheriting the previous status would let a
            // rejected pack be re-approved by swapping the file underneath it.
            verificationStatus: 'PENDING',
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.CUSTOMER_DOCUMENT_UPLOADED,
            entityType: 'CUSTOMER_DOCUMENT',
            entityId: row.documentId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              customerId,
              documentType: row.documentType,
              version: row.version,
              mimeType,
              size: stored.size,
              checksum: stored.checksum,
              replaced: superseded?.documentId ?? null,
            },
          },
          tx,
        );

        return row;
      });

      return toSummary(created);
    } catch (error) {
      // The row never landed, so nothing references these bytes. Removing them
      // is the difference between a failed upload and a permanent orphan.
      await this.storage.remove(stored.fileRef);
      throw error;
    }
  }

  /** Per-document review, independent of the overall KYC decision. */
  async verify(
    actor: AuthContext,
    customerId: string,
    documentId: string,
    dto: VerifyDocumentDto,
    meta: RequestMeta,
  ): Promise<CustomerDocumentSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      documentId,
      meta,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.customerDocument.update({
        where: {
          orgId_documentId: { orgId: actor.orgId, documentId },
        },
        data: {
          verificationStatus: dto.status,
          verificationReason: dto.reason ?? null,
          verifiedBy: actor.userId,
          verifiedAt: new Date(),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            dto.status === 'VERIFIED'
              ? AuditAction.CUSTOMER_DOCUMENT_VERIFIED
              : AuditAction.CUSTOMER_DOCUMENT_REJECTED,
          entityType: 'CUSTOMER_DOCUMENT',
          entityId: documentId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            customerId,
            documentType: row.documentType,
            reason: dto.reason ?? null,
          },
          oldData: { verificationStatus: existing.verificationStatus },
          newData: { verificationStatus: row.verificationStatus },
        },
        tx,
      );

      return row;
    });

    return toSummary(updated);
  }

  /**
   * Streams a stored document (Scenarios 12, 32).
   *
   * The scope check runs before the file is opened, and the audit entry is
   * written before the stream is handed back — so a read is recorded even if the
   * client disconnects mid-transfer. For regulated personal data, "who looked at
   * this" is itself part of the record, which is the whole reason files are
   * routed through the API instead of served statically.
   */
  async download(
    actor: AuthContext,
    customerId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<{
    stream: Readable;
    mimeType: string;
    fileName: string;
    size: number | null;
  }> {
    // Resolves the customer first: a document whose customer is out of scope is
    // refused here, before its own row is ever read.
    await this.customers.findInScope(actor, customerId, meta);
    const row = await this.findInScope(actor, customerId, documentId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_DOCUMENT_DOWNLOADED,
      entityType: 'CUSTOMER_DOCUMENT',
      entityId: documentId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        customerId,
        documentType: row.documentType,
        version: row.version,
      },
    });

    return {
      stream: await this.storage.read(row.fileRef),
      mimeType: row.mimeType ?? 'application/octet-stream',
      fileName:
        row.fileName ?? `${row.documentType.toLowerCase()}-${row.version}`,
      size: row.fileSize,
    };
  }

  /**
   * Resolves a document within the customer, or refuses.
   *
   * The `customerId` in the `where` is not redundant with the caller having
   * already resolved the customer: without it, a document id belonging to a
   * different customer in the same organization would resolve, letting a caller
   * read another branch's document by pairing it with a customer id they can
   * reach. That is Scenario 32's direct-access attempt in its most plausible
   * form.
   */
  private async findInScope(
    actor: AuthContext,
    customerId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<DocumentRow> {
    const row = await this.prisma.customerDocument.findFirst({
      where: { orgId: actor.orgId, customerId, documentId },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_DOCUMENT_ACCESS_DENIED,
        entityType: 'CUSTOMER_DOCUMENT',
        entityId: documentId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, actorBranchId: actor.branchId },
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async recordUploadRejection(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_DOCUMENT_REJECTED_UPLOAD,
      entityType: 'CUSTOMER_DOCUMENT',
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, ...metadata },
    });
  }
}
