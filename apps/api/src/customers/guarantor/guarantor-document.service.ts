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
  DocumentVerificationStatus,
  GuarantorDocumentSummary,
  GuarantorDocumentType,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from '../customer/customer.service';
import { UploadGuarantorDocumentDto } from './dto/upload-guarantor-document.dto';
import { VerifyGuarantorDocumentDto } from './dto/verify-guarantor-document.dto';
import { FILE_STORAGE, type FileStorage } from '../storage/file-storage';
import {
  ALLOWED_DOCUMENT_LABEL,
  sniffDocumentMimeType,
} from '../storage/sniff-mime';

export const CUSTOMERS_GUARANTORS_DOCUMENTS_UPLOAD_PERMISSION =
  'customers.guarantors.documents.upload';
export const CUSTOMERS_GUARANTORS_DOCUMENTS_VERIFY_PERMISSION =
  'customers.guarantors.documents.verify';
export const CUSTOMERS_GUARANTORS_DOCUMENTS_DOWNLOAD_PERMISSION =
  'customers.guarantors.documents.download';

const NOT_REACHABLE = 'Document not found';

/**
 * What a guarantor's KYC pack must contain before it can be approved
 * (Q-GUAR-9, Q-GUAR-10; Scenario 21).
 *
 * **`PHOTO` is deliberately absent**, unlike the borrower's required set. Open
 * Question 9 asks whether a guarantor photo is required and the source never
 * answers; requiring one would block every approval on a document nobody agreed
 * to collect. It remains an accepted *type* — a branch that gathers one can
 * still upload it — just not a demanded one.
 */
export const REQUIRED_GUARANTOR_KYC_DOCUMENTS: readonly GuarantorDocumentType[] =
  ['ID', 'ADDRESS'];

type GuarantorDocumentRow = {
  orgId: string;
  documentId: string;
  guarantorId: string;
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

function toSummary(row: GuarantorDocumentRow): GuarantorDocumentSummary {
  return {
    documentId: row.documentId,
    guarantorId: row.guarantorId,
    documentType: row.documentType as GuarantorDocumentType,
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
 * Guarantor KYC documents (Module 05 Scenarios 20, 21, 45).
 *
 * A deliberate near-copy of `DocumentService`. The storage rules are identical —
 * sniffed content types, supersede-on-replace, nothing reachable by URL — and a
 * reviewer who has learned one should not have to learn a second. What is *not*
 * shared is the table: Rule 18 and Scenario 22 require guarantor KYC to be kept
 * apart from the borrower's, and a single `documents` table with a nullable
 * `guarantorId` is precisely how a guarantor's ID would end up counting toward
 * the customer's required three.
 *
 * Scope is resolved twice on every entry point, customer first and guarantor
 * second, because a document is only reachable through a guarantor who is only
 * reachable through a customer the caller can already see.
 */
@Injectable()
export class GuarantorDocumentService {
  private readonly logger = new Logger(GuarantorDocumentService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {
    // The same cap the customer pack uses: one number, so a file cannot be
    // accepted by one surface and refused by the other.
    this.maxBytes =
      this.config.get<number>('customers.maxDocumentBytes') ?? 5 * 1024 * 1024;
  }

  /** The guarantor's documents, current versions first. */
  async list(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<GuarantorDocumentSummary[]> {
    await this.assertGuarantorInScope(actor, customerId, guarantorId, meta);

    const rows = await this.prisma.guarantorDocument.findMany({
      where: { orgId: actor.orgId, guarantorId },
      orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
    });

    return rows.map(toSummary);
  }

  /**
   * Scenarios 20, 45 — stores an uploaded guarantor document.
   *
   * Validated, then written to storage, then recorded — in that order. A write
   * that succeeds on disk but fails in the database is cleaned up explicitly,
   * because the alternative is an orphaned file in a directory of regulated
   * personal data that nothing knows about and no retention policy will reach.
   */
  async upload(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: UploadGuarantorDocumentDto,
    file: { buffer: Buffer; originalname?: string } | undefined,
    meta: RequestMeta,
  ): Promise<GuarantorDocumentSummary> {
    await this.assertGuarantorInScope(actor, customerId, guarantorId, meta);

    const buffer = file?.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new BadRequestException('Select a file to upload');
    }

    if (buffer.byteLength > this.maxBytes) {
      await this.recordUploadRejection(actor, customerId, guarantorId, meta, {
        reason: 'TOO_LARGE',
        size: buffer.byteLength,
      });
      throw new BadRequestException(
        `File is too large. The maximum size is ${Math.floor(
          this.maxBytes / (1024 * 1024),
        )} MB.`,
      );
    }

    // Decided by content, never by the filename or the header the client sent.
    const mimeType = sniffDocumentMimeType(buffer);
    if (!mimeType) {
      await this.recordUploadRejection(actor, customerId, guarantorId, meta, {
        reason: 'UNSUPPORTED_TYPE',
        claimedName: file?.originalname ?? null,
      });
      throw new BadRequestException(
        `Unsupported file type. Upload a ${ALLOWED_DOCUMENT_LABEL} file.`,
      );
    }

    const superseded = await this.prisma.guarantorDocument.findFirst({
      where: {
        orgId: actor.orgId,
        guarantorId,
        documentType: dto.documentType,
        supersededAt: null,
      },
      orderBy: { version: 'desc' },
    });

    // Filed under the customer, not the guarantor: a per-customer retention
    // sweep should reach the whole relationship's paperwork in one place.
    const stored = await this.storage.save({
      orgId: actor.orgId,
      ownerId: customerId,
      buffer,
      mimeType,
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // The previous version is retained and marked, not deleted: it is what a
        // reviewer's earlier decision referred to.
        if (superseded) {
          await tx.guarantorDocument.update({
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
              action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_SUPERSEDED,
              entityType: 'GUARANTOR_DOCUMENT',
              entityId: superseded.documentId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                customerId,
                guarantorId,
                documentType: dto.documentType,
                version: superseded.version,
              },
            },
            tx,
          );
        }

        const row = await tx.guarantorDocument.create({
          data: {
            orgId: actor.orgId,
            guarantorId,
            documentType: dto.documentType,
            documentNumber: dto.documentNumber ?? null,
            fileRef: stored.fileRef,
            fileName: file?.originalname?.slice(0, 255) ?? null,
            mimeType,
            fileSize: stored.size,
            version: (superseded?.version ?? 0) + 1,
            uploadedBy: actor.userId,
            // Rule 19 — uploading is not verifying. A fresh upload is always
            // unverified, even when it replaces a verified document, or a
            // rejected pack could be re-approved by swapping the file underneath.
            verificationStatus: 'PENDING',
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_UPLOADED,
            entityType: 'GUARANTOR_DOCUMENT',
            entityId: row.documentId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              customerId,
              guarantorId,
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
      // Scenario 45 — the row never landed, so nothing references these bytes.
      // Removing them is the difference between a failed upload and a permanent
      // orphan, and the guarantor's KYC state is untouched either way.
      await this.storage.remove(stored.fileRef);
      throw error;
    }
  }

  /** Per-document review, independent of the overall guarantor KYC decision. */
  async verify(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    documentId: string,
    dto: VerifyGuarantorDocumentDto,
    meta: RequestMeta,
  ): Promise<GuarantorDocumentSummary> {
    await this.assertGuarantorInScope(actor, customerId, guarantorId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      documentId,
      meta,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.guarantorDocument.update({
        where: { orgId_documentId: { orgId: actor.orgId, documentId } },
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
              ? AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_VERIFIED
              : AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_REJECTED,
          entityType: 'GUARANTOR_DOCUMENT',
          entityId: documentId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            customerId,
            guarantorId,
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
   * Streams a stored guarantor document.
   *
   * The scope check runs before the file is opened and the audit entry is
   * written before the stream is handed back, so a read is recorded even if the
   * client disconnects mid-transfer. For regulated personal data belonging to a
   * third party who is not the borrower, "who looked at this" is itself part of
   * the record (Rule 11).
   */
  async download(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<{
    stream: Readable;
    mimeType: string;
    fileName: string;
    size: number | null;
  }> {
    await this.assertGuarantorInScope(actor, customerId, guarantorId, meta);
    const row = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      documentId,
      meta,
    );

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_DOWNLOADED,
      entityType: 'GUARANTOR_DOCUMENT',
      entityId: documentId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        customerId,
        guarantorId,
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
   * Scenario 21 — what is still missing before KYC can be approved.
   *
   * Returns the required types that have no current *verified* document.
   * Uploading is not verifying (Rule 19), so a pack of unreviewed files is
   * incomplete however many of them there are. Superseded rows are ignored: a
   * verified document that has since been replaced no longer evidences anything.
   *
   * Returns a list rather than a boolean so the caller can name what is missing,
   * which is what Scenario 21 asks be displayed.
   */
  async missingRequirements(
    orgId: string,
    guarantorId: string,
  ): Promise<GuarantorDocumentType[]> {
    const rows = await this.prisma.guarantorDocument.findMany({
      where: {
        orgId,
        guarantorId,
        supersededAt: null,
        verificationStatus: 'VERIFIED',
      },
    });

    const verified = new Set(rows.map((row) => row.documentType));

    return REQUIRED_GUARANTOR_KYC_DOCUMENTS.filter(
      (type) => !verified.has(type),
    );
  }

  /**
   * Resolves the guarantor, refusing anything outside the caller's reach.
   *
   * Customer first, then guarantor: a guarantor whose customer is out of scope
   * is refused before its own row is read. Shared by every entry point here so
   * the two-step check cannot be forgotten on one of them.
   */
  private async assertGuarantorInScope(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.customers.findInScope(actor, customerId, meta);

    const guarantor = await this.prisma.guarantor.findFirst({
      where: { orgId: actor.orgId, customerId, guarantorId },
    });

    if (!guarantor) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_GUARANTOR_ACCESS_DENIED,
        entityType: 'GUARANTOR',
        entityId: guarantorId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, actorBranchId: actor.branchId },
      });

      throw new NotFoundException('Guarantor not found');
    }
  }

  /**
   * Resolves a document within the guarantor, or refuses.
   *
   * `guarantorId` in the `where` is load-bearing for the same reason
   * `DocumentService` keeps `customerId` there: without it, a document id
   * belonging to a different guarantor in the same organization would resolve,
   * letting a caller read another branch's document by pairing it with a
   * guarantor they can reach.
   */
  private async findInScope(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<GuarantorDocumentRow> {
    const row = await this.prisma.guarantorDocument.findFirst({
      where: { orgId: actor.orgId, guarantorId, documentId },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_ACCESS_DENIED,
        entityType: 'GUARANTOR_DOCUMENT',
        entityId: documentId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, guarantorId, actorBranchId: actor.branchId },
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async recordUploadRejection(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_DOCUMENT_REJECTED_UPLOAD,
      entityType: 'GUARANTOR_DOCUMENT',
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, guarantorId, ...metadata },
    });
  }
}
