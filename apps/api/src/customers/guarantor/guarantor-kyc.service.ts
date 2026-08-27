import { ConflictException, Injectable } from '@nestjs/common';
import type { GuarantorKycStatus, GuarantorSummary } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from '../customer/customer.service';
import { ReviewGuarantorKycDto } from './dto/review-guarantor-kyc.dto';
import { SubmitGuarantorKycDto } from './dto/submit-guarantor-kyc.dto';
import { GuarantorDocumentService } from './guarantor-document.service';
import { type GuarantorRow, toGuarantorSummary } from './guarantor.service';

export const CUSTOMERS_GUARANTORS_KYC_REVIEW_PERMISSION =
  'customers.guarantors.kyc.review';

/**
 * Guarantor KYC review (Module 05 Scenarios 20-25).
 *
 * **The whole point of this file is what it does not touch.** Scenario 22 and
 * Rule 75 require that guarantor KYC and borrower KYC be independent: approving
 * one must never approve the other, and a borrower with approved KYC gives their
 * guarantor no standing at all. That is enforced structurally rather than by a
 * check — this service writes to `Guarantor.kycStatus` and nothing else. It
 * never opens `Customer` or `CustomerKyc`, so there is no path by which a
 * guarantor decision could reach the borrower's record.
 *
 * Note the deliberate asymmetry with `KycService`: approving a *customer's* KYC
 * also activates the customer (Scenario 9 there). Approving a guarantor's KYC
 * activates nothing. A guarantor's `status` is a separate lifecycle owned by
 * `GuarantorService`, and conflating "their paperwork is in order" with "they
 * are available for new relationships" would let a KYC approval silently undo a
 * deliberate deactivation.
 *
 * State is held on the guarantor row rather than in a `GuarantorKyc` table.
 * Unlike a customer, a guarantor has exactly one KYC pack with no conversion
 * path and no history of superseded records, so a second table would carry one
 * row per guarantor forever and add a join to every read.
 */
@Injectable()
export class GuarantorKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
    private readonly documents: GuarantorDocumentService,
  ) {}

  /**
   * Scenario 20 — submits the assembled pack for review.
   *
   * Permitted from NOT_REQUIRED, PENDING, REVISION_REQUIRED and REJECTED. The
   * first is the ordinary path: a guarantor starts NOT_REQUIRED because no loan
   * product has yet said otherwise, and submitting is what asserts KYC applies
   * to this one (Q-GUAR-11). An already-APPROVED pack is refused — reopening it
   * is a revision request, which is a reviewer's decision and not the branch's.
   */
  async submit(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: SubmitGuarantorKycDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(actor, customerId, guarantorId);

    this.assertVersion(existing, dto.expectedVersion);

    if (existing.kycStatus === 'APPROVED') {
      throw new ConflictException(
        'This guarantor KYC has already been approved.',
      );
    }

    if (existing.kycStatus === 'SUBMITTED') {
      throw new ConflictException(
        'This guarantor KYC is already awaiting review.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.guarantor.update({
        where: { orgId_guarantorId: { orgId: actor.orgId, guarantorId } },
        data: {
          kycStatus: 'SUBMITTED',
          kycSubmittedAt: new Date(),
          // Cleared on resubmission: the reason described the previous pack,
          // and leaving it would make a fixed submission still look faulty.
          kycRevisionReason: null,
          updatedBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_GUARANTOR_KYC_SUBMITTED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId },
          oldData: { kycStatus: existing.kycStatus },
          newData: { kycStatus: row.kycStatus },
        },
        tx,
      );

      return row;
    });

    return toGuarantorSummary(updated);
  }

  /**
   * Scenarios 21, 23, 24, 25 — the reviewer's decision.
   *
   * An approval is gated on the required documents actually being verified
   * (Scenario 21). Uploading is not verifying (Rule 19), so a pack of unreviewed
   * files cannot be approved however complete it looks — and Rule 25 says a
   * guarantor with incomplete KYC must not be treated as fully verified.
   */
  async review(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: ReviewGuarantorKycDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(actor, customerId, guarantorId);

    this.assertVersion(existing, dto.expectedVersion);

    if (existing.kycStatus === 'NOT_REQUIRED') {
      throw new ConflictException(
        'This guarantor has no KYC to review. Submit it first.',
      );
    }

    if (dto.decision === 'APPROVE') {
      await this.assertDocumentsComplete(actor, customerId, guarantorId, meta);
    }

    const nextStatus: GuarantorKycStatus =
      dto.decision === 'APPROVE'
        ? 'APPROVED'
        : dto.decision === 'REJECT'
          ? 'REJECTED'
          : 'REVISION_REQUIRED';

    const updated = await this.prisma.$transaction(async (tx) => {
      // Writes to `guarantor` and to nothing else. See the class docblock: the
      // borrower's record is deliberately unreachable from here (Scenario 22).
      const row = await tx.guarantor.update({
        where: { orgId_guarantorId: { orgId: actor.orgId, guarantorId } },
        data: {
          kycStatus: nextStatus,
          kycReviewedAt: new Date(),
          kycReviewedBy: actor.userId,
          // Retained for a revision so the branch knows what to fix
          // (Scenario 23); cleared on approval, where it no longer applies.
          kycRevisionReason:
            dto.decision === 'APPROVE' ? null : (dto.reason ?? null),
          updatedBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            dto.decision === 'APPROVE'
              ? AuditAction.CUSTOMER_GUARANTOR_KYC_APPROVED
              : dto.decision === 'REJECT'
                ? AuditAction.CUSTOMER_GUARANTOR_KYC_REJECTED
                : AuditAction.CUSTOMER_GUARANTOR_KYC_REVISION_REQUESTED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            customerId,
            decision: dto.decision,
            reason: dto.reason ?? null,
          },
          oldData: { kycStatus: existing.kycStatus },
          newData: { kycStatus: row.kycStatus },
        },
        tx,
      );

      return row;
    });

    return toGuarantorSummary(updated);
  }

  /**
   * Scenario 21 — refuses an approval whose required documents are not verified.
   *
   * The blocked attempt is audited as its own action rather than as a rejection:
   * nobody decided against this pack, the system declined to let it through, and
   * an audit trail that conflated the two would misattribute a refusal to the
   * reviewer.
   */
  private async assertDocumentsComplete(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const missing = await this.documents.missingRequirements(
      actor.orgId,
      guarantorId,
    );

    if (missing.length === 0) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_KYC_APPROVAL_BLOCKED,
      entityType: 'GUARANTOR',
      entityId: guarantorId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, missing },
    });

    throw new ConflictException(
      `Guarantor KYC cannot be approved until every required document is verified. Missing: ${missing.join(
        ', ',
      )}.`,
    );
  }

  private async findInScope(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
  ): Promise<GuarantorRow> {
    const row = await this.prisma.guarantor.findFirst({
      where: { orgId: actor.orgId, customerId, guarantorId },
    });

    if (!row) {
      throw new ConflictException('Guarantor not found');
    }

    return row;
  }

  /**
   * Optimistic concurrency, matching `GuarantorService.assertVersion`.
   *
   * Not audited here, unlike there: a stale KYC decision is a reviewer refreshing
   * a stale screen rather than a contested edit, and the decision that does land
   * is audited in full either way.
   */
  private assertVersion(row: GuarantorRow, expectedVersion: string): void {
    if (row.updatedAt.toISOString() === expectedVersion) return;

    throw new ConflictException(
      'This guarantor was changed by someone else. Reload and try again.',
    );
  }
}
