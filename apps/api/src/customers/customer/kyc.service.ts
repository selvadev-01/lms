import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { KycLifecycleStatus, KycRecord } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from './customer.service';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';

export const CUSTOMERS_KYC_VIEW_PERMISSION = 'customers.kyc.view';
export const CUSTOMERS_KYC_SUBMIT_PERMISSION = 'customers.kyc.submit';
export const CUSTOMERS_KYC_APPROVE_PERMISSION = 'customers.kyc.approve';

/**
 * The document categories standard KYC requires (Rule 7, Scenario 6).
 *
 * Fixed rather than configurable. The source names ID, Address and Photo
 * outright, and a deployment able to switch off the address requirement could
 * approve a customer the story considers incomplete — which is the one outcome
 * this module exists to prevent.
 *
 * Loan-side documents (income, collateral) are deliberately not members: the
 * story warns they must not be treated as the same domain category, and a shared
 * required-set is exactly how that would happen by accident.
 */
export const REQUIRED_KYC_DOCUMENTS = ['ID', 'ADDRESS', 'PHOTO'] as const;

const NOT_REACHABLE = 'KYC record not found';

type KycRow = {
  orgId: string;
  kycId: string;
  customerId: string;
  status: KycLifecycleStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  revisionReason: string | null;
  updatedAt: Date;
};

function toRecord(row: KycRow, reviewerName?: string): KycRecord {
  return {
    kycId: row.kycId,
    customerId: row.customerId,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedByName: reviewerName,
    revisionReason: row.revisionReason ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

/**
 * The KYC review workflow (Module 04, Scenarios 6-12).
 *
 * The source defines a loop rather than a straight line: upload → review →
 * either approved, or returned for revision and back to upload. That loop is the
 * reason `REVISION_REQUIRED` is a distinct state from `REJECTED` — the first
 * expects the customer to come back, the second does not.
 *
 * Branch Admin is the named approval authority (Rule 9), expressed as the
 * `customers.kyc.approve` permission rather than as a role check, so an
 * organization that renames or splits the role does not lose the control.
 *
 * Every path here reaches its customer through `CustomerService.findInScope`, so
 * the branch and tenant rules are applied once, in one place. A KYC record is
 * never loaded by its own id alone.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
  ) {}

  /** Reads the customer's current KYC record. */
  async get(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<KycRecord> {
    await this.customers.findInScope(actor, customerId, meta);
    const row = await this.currentRecord(actor.orgId, customerId);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_KYC_VIEWED,
      entityType: 'CUSTOMER_KYC',
      entityId: row.kycId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, status: row.status },
    });

    const reviewer = row.reviewedBy
      ? await this.prisma.user.findFirst({
          where: { orgId: actor.orgId, userId: row.reviewedBy },
          select: { name: true },
        })
      : null;

    return toRecord(row, reviewer?.name);
  }

  /**
   * Submits the assembled pack for review (Scenario 6).
   *
   * Deliberately does **not** require the documents to be complete. A branch can
   * upload what it has and submit; completeness is checked at approval, where
   * the reviewer sees what is missing. Blocking submission instead would mean a
   * customer with an unobtainable document never reaches anyone who can decide
   * what to do about it.
   */
  async submit(
    actor: AuthContext,
    customerId: string,
    dto: SubmitKycDto,
    meta: RequestMeta,
  ): Promise<KycRecord> {
    const customer = await this.customers.findInScope(actor, customerId, meta);

    if (customer.customerType !== 'KYC') {
      // Scenario 13 — a LOCAL customer has no KYC record to submit, and
      // creating one on demand would put them in a review queue they are
      // defined by not being in.
      throw new ConflictException(
        'This is a Local customer and does not require KYC',
      );
    }

    const existing = await this.currentRecord(actor.orgId, customerId);
    this.assertVersion(existing, dto.expectedVersion);

    if (existing.status === 'APPROVED') {
      throw new ConflictException('KYC has already been approved');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.customerKyc.update({
        where: { orgId_kycId: { orgId: actor.orgId, kycId: existing.kycId } },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          // Cleared on resubmission: the previous reason described the pack that
          // has just been replaced, and leaving it would show a revision demand
          // against documents that already answered it.
          revisionReason: null,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_KYC_SUBMITTED,
          entityType: 'CUSTOMER_KYC',
          entityId: row.kycId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId },
          oldData: { status: existing.status },
          newData: { status: row.status },
        },
        tx,
      );

      return row;
    });

    return toRecord(updated);
  }

  /**
   * The Branch Admin review decision (Scenarios 8, 9, 10).
   *
   * Approval and activation happen in **one transaction** (Scenario 39): if the
   * commit fails, the customer does not falsely become ACTIVE, because neither
   * write lands. Splitting them would create a window where an approved KYC
   * record sits against a PENDING customer, and a retry would have to know which
   * half had already succeeded.
   */
  async review(
    actor: AuthContext,
    customerId: string,
    dto: ReviewKycDto,
    meta: RequestMeta,
  ): Promise<KycRecord> {
    const customer = await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.currentRecord(actor.orgId, customerId);
    this.assertVersion(existing, dto.expectedVersion);

    if (existing.status === 'APPROVED') {
      throw new ConflictException('KYC has already been approved');
    }

    if (dto.decision === 'APPROVE') {
      await this.assertDocumentsComplete(
        actor,
        customerId,
        existing.kycId,
        meta,
      );
    }

    const now = new Date();
    const nextStatus: KycLifecycleStatus =
      dto.decision === 'APPROVE'
        ? 'APPROVED'
        : dto.decision === 'REJECT'
          ? 'REJECTED'
          : 'REVISION_REQUIRED';

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.customerKyc.update({
          where: { orgId_kycId: { orgId: actor.orgId, kycId: existing.kycId } },
          data: {
            status: nextStatus,
            reviewedAt: now,
            reviewedBy: actor.userId,
            revisionReason: dto.reason ?? null,
          },
        });

        // Scenario 9 — an approved customer becomes ACTIVE. Only on approval:
        // a rejection leaves the customer wherever they were, because refusing
        // KYC is not the same decision as deactivating an existing customer.
        if (dto.decision === 'APPROVE') {
          await tx.customer.update({
            where: { orgId_customerId: { orgId: actor.orgId, customerId } },
            data: { status: 'ACTIVE' },
          });
        }

        await this.audit.record(
          {
            orgId: actor.orgId,
            action:
              dto.decision === 'APPROVE'
                ? AuditAction.CUSTOMER_KYC_APPROVED
                : dto.decision === 'REJECT'
                  ? AuditAction.CUSTOMER_KYC_REJECTED
                  : AuditAction.CUSTOMER_KYC_REVISION_REQUESTED,
            entityType: 'CUSTOMER_KYC',
            entityId: row.kycId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            // Scenario 34 names the approving actor, the timestamp and the
            // result. Actor and timestamp are columns on the audit row; the
            // result and its justification are here.
            metadata: {
              customerId,
              decision: dto.decision,
              reason: dto.reason ?? null,
              customerActivated: dto.decision === 'APPROVE',
            },
            oldData: {
              status: existing.status,
              customerStatus: customer.status,
            },
            newData: {
              status: row.status,
              customerStatus:
                dto.decision === 'APPROVE' ? 'ACTIVE' : customer.status,
            },
          },
          tx,
        );

        return row;
      });

      return toRecord(updated);
    } catch (error) {
      // Scenario 39 — the approval transaction failed. Recorded so an operator
      // can tell "the approval was attempted and did not commit" from "nobody
      // has reviewed this yet", which the KYC row alone cannot express.
      this.logger.error(
        `KYC review failed for customer ${customerId}`,
        error instanceof Error ? error.stack : String(error),
      );

      try {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_KYC_PERSISTENCE_FAILED,
          entityType: 'CUSTOMER_KYC',
          entityId: existing.kycId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            customerId,
            decision: dto.decision,
            error: error instanceof Error ? error.message : 'unknown error',
          },
        });
      } catch {
        // If the database is what failed, this write fails too. Swallowed so the
        // caller sees the original error rather than the bookkeeping one.
      }

      throw error;
    }
  }

  /**
   * Refuses approval unless every required category is present and verified
   * (Scenario 7).
   *
   * Both halves matter. Present-but-unverified is not enough: a reviewer who
   * approves the pack without anyone having checked the individual documents has
   * performed no verification, which is what Rule 6 asks for.
   *
   * Superseded versions are excluded, so replacing a document with a fresh
   * unverified one correctly re-blocks approval (Scenario 11).
   */
  private async assertDocumentsComplete(
    actor: AuthContext,
    customerId: string,
    kycId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const documents = await this.prisma.customerDocument.findMany({
      where: { orgId: actor.orgId, customerId, supersededAt: null },
      select: { documentType: true, verificationStatus: true },
    });

    const missing = REQUIRED_KYC_DOCUMENTS.filter(
      (type) => !documents.some((doc) => doc.documentType === type),
    );
    const unverified = REQUIRED_KYC_DOCUMENTS.filter((type) =>
      documents.some(
        (doc) =>
          doc.documentType === type && doc.verificationStatus !== 'VERIFIED',
      ),
    );

    if (missing.length === 0 && unverified.length === 0) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_KYC_APPROVAL_BLOCKED,
      entityType: 'CUSTOMER_KYC',
      entityId: kycId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, missing, unverified },
    });

    throw new ConflictException(
      missing.length > 0
        ? `KYC cannot be approved until these documents are uploaded: ${missing.join(', ')}`
        : `KYC cannot be approved until these documents are verified: ${unverified.join(', ')}`,
    );
  }

  /**
   * The customer's current KYC record.
   *
   * `findFirst` ordered newest-first rather than `findUnique`, because
   * conversion creates a second record against the same customer (Scenario 27)
   * and the older one must stay for history. The newest is the live one.
   */
  private async currentRecord(
    orgId: string,
    customerId: string,
  ): Promise<KycRow> {
    const row = await this.prisma.customerKyc.findFirst({
      where: { orgId, customerId },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) {
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  /**
   * Optimistic concurrency for the review path (Scenario 40).
   *
   * Two reviewers opening the same pending record and deciding differently is
   * the exact conflict the story describes; the second decision is refused
   * rather than overwriting the first, so the record cannot reach a final state
   * neither reviewer chose.
   */
  private assertVersion(row: KycRow, expectedVersion: string): void {
    if (row.updatedAt.toISOString() === expectedVersion) return;

    throw new ConflictException(
      'This KYC record was changed by someone else. Reload and try again.',
    );
  }
}
