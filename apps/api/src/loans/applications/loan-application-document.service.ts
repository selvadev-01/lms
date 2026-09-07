import type { Readable } from 'node:stream';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoanApplicationDocumentSummary } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../../customers/storage/file-storage';
import {
  ALLOWED_DOCUMENT_LABEL,
  sniffDocumentMimeType,
} from '../../customers/storage/sniff-mime';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ReuseApplicationDocumentDto,
  UploadApplicationDocumentDto,
  VerifyApplicationDocumentDto,
} from './dto/loan-application.dto';
import { LoanApplicationService } from './loan-application.service';
import {
  toDocumentSummary,
  type ApplicationDocumentRow,
} from './loan-application.mapper';

export const APPLICATIONS_DOCUMENTS_VIEW_PERMISSION =
  'loans.applications.documents.view';
export const APPLICATIONS_DOCUMENTS_UPLOAD_PERMISSION =
  'loans.applications.documents.upload';
export const APPLICATIONS_DOCUMENTS_VERIFY_PERMISSION =
  'loans.applications.documents.verify';
export const APPLICATIONS_DOCUMENTS_DOWNLOAD_PERMISSION =
  'loans.applications.documents.download';

const NOT_REACHABLE = 'Document not found';

/**
 * Loan application supporting documents (Scenarios 17-20).
 *
 * A deliberate near-copy of `DocumentService` and `GuarantorDocumentService`.
 * The storage rules are identical — content sniffed rather than trusted,
 * supersede-on-replace rather than overwrite, nothing reachable by URL — and a
 * reviewer who has learned one should not have to learn a third.
 *
 * What is *not* shared is the table. Borrower KYC, guarantor KYC and loan
 * support documents live in three tables under three permissions, so an
 * application reviewer's reach never extends to the borrower's identity pack and
 * a KYC approver never sees collateral papers. A single `documents` table with
 * nullable owner columns is exactly how that separation would erode.
 *
 * Scope resolves through `LoanApplicationService.findInScope`, so a document is
 * only reachable through an application the caller can already see (Scenario 20).
 */
@Injectable()
export class LoanApplicationDocumentService {
  private readonly logger = new Logger(LoanApplicationDocumentService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: LoanApplicationService,
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {
    // The same cap the customer and guarantor packs use: one number, so a file
    // cannot be accepted by one surface and refused by another.
    this.maxBytes =
      this.config.get<number>('customers.maxDocumentBytes') ?? 5 * 1024 * 1024;
  }

  async list(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<LoanApplicationDocumentSummary[]> {
    await this.applications.findInScope(actor, applicationId, meta);

    const rows = await this.prisma.loanApplicationDocument.findMany({
      where: { orgId: actor.orgId, applicationId, supersededAt: null },
      orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
    });

    return (rows as unknown as ApplicationDocumentRow[]).map(toDocumentSummary);
  }

  /**
   * A decided application's evidence is fixed.
   *
   * Allowing a document to be attached after approval would let the pack a
   * decision rested on change underneath it. Shared by `upload` and `reuse`
   * rather than written twice — a second copy is how one of them ends up
   * missing a status the other refuses.
   */
  private assertAcceptsDocuments(status: string): void {
    if (status === 'APPROVED' || status === 'REJECTED') {
      throw new ConflictException(
        `Documents cannot be attached to an application that is ${status}`,
      );
    }
  }

  /**
   * Attaches a supporting document, superseding any current one of the same type.
   *
   * The bytes are written before the row so a storage failure never produces a
   * row pointing at nothing; if the row then fails to commit, the bytes are
   * removed in the catch. That ordering is what Scenario 19 asks for — a failed
   * upload must not mark the requirement satisfied.
   */
  async upload(
    actor: AuthContext,
    applicationId: string,
    dto: UploadApplicationDocumentDto,
    file: { buffer: Buffer; originalname?: string } | undefined,
    meta: RequestMeta,
  ): Promise<LoanApplicationDocumentSummary> {
    const application = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    this.assertAcceptsDocuments(application.status);

    const buffer = file?.buffer;

    if (!buffer || buffer.byteLength === 0) {
      await this.recordUploadRejection(actor, applicationId, meta, {
        reason: 'EMPTY',
      });
      throw new BadRequestException('Select a file to upload');
    }

    if (buffer.byteLength > this.maxBytes) {
      await this.recordUploadRejection(actor, applicationId, meta, {
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
      await this.recordUploadRejection(actor, applicationId, meta, {
        reason: 'UNSUPPORTED_TYPE',
        claimedName: file?.originalname ?? null,
      });
      throw new BadRequestException(
        `Unsupported file type. Upload a ${ALLOWED_DOCUMENT_LABEL} file.`,
      );
    }

    const superseded = await this.prisma.loanApplicationDocument.findFirst({
      where: {
        orgId: actor.orgId,
        applicationId,
        documentType: dto.documentType,
        supersededAt: null,
      },
      orderBy: { version: 'desc' },
    });

    // Filed under the application, so a per-application retention sweep reaches
    // the whole pack in one place.
    const stored = await this.storage.save({
      orgId: actor.orgId,
      ownerId: applicationId,
      buffer,
      mimeType,
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // The previous version is retained and marked, not deleted: it is what a
        // reviewer's earlier decision referred to (Rule 91).
        if (superseded) {
          await tx.loanApplicationDocument.update({
            where: {
              orgId_applicationDocumentId: {
                orgId: actor.orgId,
                applicationDocumentId: superseded.applicationDocumentId,
              },
            },
            data: { supersededAt: new Date() },
          });

          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.LOAN_APPLICATION_DOCUMENT_SUPERSEDED,
              entityType: 'LOAN_APPLICATION_DOCUMENT',
              entityId: superseded.applicationDocumentId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                applicationId,
                documentType: dto.documentType,
                version: superseded.version,
              },
            },
            tx,
          );
        }

        const row = await tx.loanApplicationDocument.create({
          data: {
            orgId: actor.orgId,
            applicationId,
            documentType: dto.documentType,
            documentNumber: dto.documentNumber ?? null,
            fileRef: stored.fileRef,
            fileName: file?.originalname?.slice(0, 255) ?? null,
            mimeType,
            fileSize: stored.size,
            version: (superseded?.version ?? 0) + 1,
            uploadedBy: actor.userId,
            // Uploading is not verifying. A fresh upload is always unreviewed,
            // even when it replaces a verified document — otherwise a rejected
            // pack could be re-approved by swapping the file underneath it.
            status: 'PENDING',
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_APPLICATION_DOCUMENT_UPLOADED,
            entityType: 'LOAN_APPLICATION_DOCUMENT',
            entityId: row.applicationDocumentId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              applicationId,
              documentType: row.documentType,
              version: row.version,
              mimeType,
              size: stored.size,
              checksum: stored.checksum,
              replaced: superseded?.applicationDocumentId ?? null,
            },
          },
          tx,
        );

        return row;
      });

      return toDocumentSummary(created);
    } catch (error) {
      // Scenario 19: the row never landed, so nothing references these bytes.
      // Removing them is the difference between a failed upload and a permanent
      // orphan, and the application's completeness is untouched either way.
      await this.storage.remove(stored.fileRef);
      this.logger.error(
        `Loan application document upload failed for org ${actor.orgId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * Documents this customer already produced on an earlier application.
   *
   * Documents belong to an application, not to a customer, so a repeat borrower
   * is asked for the same ID and income proof on every loan. This is the read
   * behind the "reuse" control: it offers what they filed last time so a clerk
   * confirms rather than re-scans.
   *
   * Scoped through the customer, and only their *other* applications — never a
   * document already on this one, and never another borrower's. The tenant
   * boundary is `orgId` as everywhere else.
   */
  async reusable(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<LoanApplicationDocumentSummary[]> {
    const application = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    const rows = await this.prisma.loanApplicationDocument.findMany({
      where: {
        orgId: actor.orgId,
        supersededAt: null,
        application: {
          orgId: actor.orgId,
          customerId: application.customerId,
          applicationId: { not: applicationId },
        },
      },
      // Newest first, so the most recent copy of a type leads — an income proof
      // from last month is the one worth offering, not one from three loans ago.
      orderBy: [{ documentType: 'asc' }, { createdAt: 'desc' }],
    });

    /**
     * One per type: the newest.
     *
     * Narrowed here rather than in the browser because a long-standing borrower
     * accumulates a document per type per loan — a seeded fixture already
     * reaches into the hundreds — and every one of those is a row the client
     * would download to show a single button. The caller wants "what would I
     * reuse for ID", which has exactly one answer.
     */
    const newestByType = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!newestByType.has(row.documentType)) {
        newestByType.set(row.documentType, row);
      }
    }

    return [...newestByType.values()].map((row) => toDocumentSummary(row));
  }

  /**
   * Attach a document the same customer filed on an earlier application.
   *
   * `fileRef` is an opaque storage key, so the new row points at the bytes
   * already stored — this is an insert, not a file copy, and nothing is
   * uploaded or duplicated.
   *
   * **Three things are deliberately not inherited.** `status` resets to PENDING,
   * and `verifiedAt`/`verificationReason`/`verifiedBy` stay null: a verification
   * decision was made about that document in the context of *that* application,
   * and carrying it across would let a past reviewer's approval silently satisfy
   * a new application's gate. `version` restarts at 1 because versioning is per
   * application — the source's supersede chain is not this application's
   * history.
   */
  async reuse(
    actor: AuthContext,
    applicationId: string,
    dto: ReuseApplicationDocumentDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDocumentSummary> {
    const application = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    this.assertAcceptsDocuments(application.status);

    const source = await this.prisma.loanApplicationDocument.findFirst({
      where: {
        orgId: actor.orgId,
        applicationDocumentId: dto.sourceDocumentId,
        supersededAt: null,
      },
      include: { application: { select: { customerId: true } } },
    });

    // The load-bearing check. Without it this endpoint would let any document be
    // attached to any application — worse than the retyping it replaces. Absent
    // and another customer's are the same answer, so an id cannot be probed.
    if (!source || source.application.customerId !== application.customerId) {
      throw new NotFoundException('Document not found');
    }

    const superseded = await this.prisma.loanApplicationDocument.findFirst({
      where: {
        orgId: actor.orgId,
        applicationId,
        documentType: source.documentType,
        supersededAt: null,
      },
      orderBy: { version: 'desc' },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      if (superseded) {
        await tx.loanApplicationDocument.update({
          where: {
            orgId_applicationDocumentId: {
              orgId: actor.orgId,
              applicationDocumentId: superseded.applicationDocumentId,
            },
          },
          data: { supersededAt: new Date() },
        });
      }

      const row = await tx.loanApplicationDocument.create({
        data: {
          orgId: actor.orgId,
          applicationId,
          documentType: source.documentType,
          documentNumber: source.documentNumber,
          // The same stored object. Both applications reference one file.
          fileRef: source.fileRef,
          fileName: source.fileName,
          mimeType: source.mimeType,
          fileSize: source.fileSize,
          version: (superseded?.version ?? 0) + 1,
          uploadedBy: actor.userId,
          status: 'PENDING',
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LOAN_APPLICATION_DOCUMENT_UPLOADED,
          entityType: 'LOAN_APPLICATION_DOCUMENT',
          entityId: row.applicationDocumentId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            applicationId,
            documentType: row.documentType,
            version: row.version,
            // Named so the trail says this was reused rather than uploaded, and
            // from where — the same file now evidences two applications.
            reusedFromDocumentId: source.applicationDocumentId,
            reusedFromApplicationId: source.applicationId,
            replaced: superseded?.applicationDocumentId ?? null,
          },
        },
        tx,
      );

      return row;
    });

    return toDocumentSummary(created);
  }

  /** Per-document review, independent of the application's own decision. */
  async verify(
    actor: AuthContext,
    applicationId: string,
    documentId: string,
    dto: VerifyApplicationDocumentDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDocumentSummary> {
    await this.applications.findInScope(actor, applicationId, meta);
    await this.findInScope(actor, applicationId, documentId, meta);

    // Checked here rather than with `@ValidateIf` in the DTO: on an otherwise
    // optional field that decorator silently skips `@IsNotEmpty`, so a missing
    // reason would pass validation entirely.
    if (dto.status === 'REJECTED' && !dto.reason?.trim()) {
      throw new BadRequestException('Give a reason when rejecting a document');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.loanApplicationDocument.update({
        where: {
          orgId_applicationDocumentId: {
            orgId: actor.orgId,
            applicationDocumentId: documentId,
          },
        },
        data: {
          status: dto.status,
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
              ? AuditAction.LOAN_APPLICATION_DOCUMENT_VERIFIED
              : AuditAction.LOAN_APPLICATION_DOCUMENT_REJECTED,
          entityType: 'LOAN_APPLICATION_DOCUMENT',
          entityId: documentId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            applicationId,
            documentType: row.documentType,
            reason: dto.reason ?? null,
          },
        },
        tx,
      );

      return row;
    });

    return toDocumentSummary(updated);
  }

  /**
   * Streams the stored bytes, having re-checked scope and recorded the read.
   *
   * Nothing serves these files statically and no URL is signed, so every read
   * passes through here (Rule 90, Scenario 20).
   */
  async download(
    actor: AuthContext,
    applicationId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<{
    stream: Readable;
    mimeType: string;
    fileName: string;
    size: number | null;
  }> {
    await this.applications.findInScope(actor, applicationId, meta);
    const row = await this.findInScope(actor, applicationId, documentId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_DOCUMENT_DOWNLOADED,
      entityType: 'LOAN_APPLICATION_DOCUMENT',
      entityId: documentId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        applicationId,
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
   * Resolves a document within the application, or refuses.
   *
   * `applicationId` in the `where` is load-bearing: without it a document id
   * from another application in the same organization would resolve, letting a
   * caller reach another branch's paperwork by pairing it with an application
   * they can see. That is Scenario 20's direct-identifier attempt.
   */
  private async findInScope(
    actor: AuthContext,
    applicationId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<ApplicationDocumentRow> {
    const row = await this.prisma.loanApplicationDocument.findFirst({
      where: {
        orgId: actor.orgId,
        applicationId,
        applicationDocumentId: documentId,
      },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_APPLICATION_DOCUMENT_ACCESS_DENIED,
        entityType: 'LOAN_APPLICATION_DOCUMENT',
        entityId: documentId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { applicationId },
      });
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async recordUploadRejection(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_DOCUMENT_REJECTED_UPLOAD,
      entityType: 'LOAN_APPLICATION_DOCUMENT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { applicationId, ...details },
    });
  }
}
