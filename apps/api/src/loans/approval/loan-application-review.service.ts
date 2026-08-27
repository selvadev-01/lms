import { computeSchedule, EmiCalculationError } from '@lms/emi';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  ApprovalBlocker,
  ApprovalReadiness,
  LoanApplicationDetail,
  LoanApplicationHistoryEntry,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { formatPaise } from '../../common/export/money-format';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplicationTransitionService,
  type TransitionSpec,
} from '../applications/application-transition.service';
import {
  CreditAssessmentService,
  toAssessmentDetail,
} from './credit-assessment.service';
import {
  ApproveApplicationDto,
  ModifyTermsDto,
  RejectApplicationDto,
  RequestMoreInfoDto,
} from '../applications/dto/loan-application.dto';
import { LoanApplicationCompletenessService } from '../applications/loan-application-completeness.service';
import { LoanApplicationService } from '../applications/loan-application.service';
import {
  toHistoryEntry,
  toIsoDate,
  type ApplicationWithRelations,
  type ReviewRow,
} from '../applications/loan-application.mapper';
import { LoanSchemeService } from '../products/loan-scheme.service';

export const APPLICATIONS_REVIEW_PERMISSION = 'loans.applications.review';
export const APPLICATIONS_MODIFY_TERMS_PERMISSION =
  'loans.applications.modify_terms';
export const APPLICATIONS_APPROVE_PERMISSION = 'loans.approve';
export const APPLICATIONS_REJECT_PERMISSION = 'loans.applications.reject';

/**
 * Module 07 — the reviewer's half of the application lifecycle.
 *
 * # The transition guard
 *
 * Every method here moves an application from one status to another through
 * `ApplicationTransitionService`, which owns the concurrency guard and the
 * audit contract. See that class for why `status` and `updatedAt` both appear
 * in the update's WHERE clause.
 *
 * # Terminal states
 *
 * REJECTED is terminal. APPROVED is *not*, since Module 08: the lifecycle
 * continues APPROVED -> SANCTIONED -> CUSTOMER_ACCEPTED -> AGREEMENT_SIGNED,
 * with a customer's decline of the sanction letter landing on REJECTED (Rule
 * 13's unified status). Those four transitions live in `LoanSanctionService`.
 *
 * AGREEMENT_SIGNED is terminal *here* because disbursal is Module 09's, not
 * because the business says a signed loan never moves again.
 */
@Injectable()
export class LoanApplicationReviewService {
  private readonly logger = new Logger(LoanApplicationReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: LoanApplicationService,
    private readonly schemes: LoanSchemeService,
    private readonly transitions: ApplicationTransitionService,
    private readonly completeness: LoanApplicationCompletenessService,
    private readonly assessments: CreditAssessmentService,
    // Module 16, from the @Global NotificationEventsModule — no imports entry
    // and no dependency on the notification pipeline.
    private readonly events: NotificationEventsService,
  ) {}

  /** T4: SUBMITTED -> UNDER_REVIEW. An explicit claim, not implicit on read. */
  async startReview(
    actor: AuthContext,
    applicationId: string,
    expectedVersion: string,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    await this.transition(actor, before, expectedVersion, meta, {
      from: ['SUBMITTED'],
      to: 'UNDER_REVIEW',
      action: AuditAction.LOAN_APPLICATION_REVIEW_STARTED,
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /** T5: UNDER_REVIEW -> MORE_INFO_REQUIRED (Scenario 22). */
  async requestMoreInfo(
    actor: AuthContext,
    applicationId: string,
    dto: RequestMoreInfoDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    await this.transition(actor, before, dto.expectedVersion, meta, {
      from: ['UNDER_REVIEW'],
      to: 'MORE_INFO_REQUIRED',
      action: AuditAction.LOAN_APPLICATION_INFO_REQUESTED,
      review: {
        reviewType: 'BRANCH_REVIEW',
        decision: 'MORE_INFO_REQUIRED',
        comments: dto.comments,
      },
      metadata: { comments: dto.comments },
    });

    // The specification's "application returned" event.
    await this.emitDecision('APPLICATION_RETURNED', actor, before, meta, {
      comments: dto.comments,
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * T7: adjust rate or duration mid-review (Scenario 16).
   *
   * Stays UNDER_REVIEW — modifying terms is not a decision on the application's
   * fate, and it still needs an approve or reject afterwards.
   *
   * The review row records the terms as they were *before* this change, which is
   * what makes the whole history reconstructible: replaying MODIFY_TERMS rows
   * oldest-first recovers every set of terms the application has had, with the
   * originally submitted terms on the earliest row (Rules 66-70, Scenario 60).
   *
   * Rule 68 — recalculate before approval — is satisfied by recomputing the EMI
   * here and refusing terms that do not compute, and again by `approve` doing
   * the same. Neither trusts the other.
   */
  async modifyTerms(
    actor: AuthContext,
    applicationId: string,
    dto: ModifyTermsDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    if (before.status !== 'UNDER_REVIEW') {
      await this.transitions.recordTransitionRejected(
        actor,
        before,
        meta,
        'NOT_UNDER_REVIEW',
      );
      throw new ConflictException(
        `Terms can only be modified while an application is under review; this one is ${before.status}`,
      );
    }

    const expected = this.transitions.assertParsableVersion(
      dto.expectedVersion,
    );

    // Same pre-read check as `transition`, for the same reason: the guard below
    // compares a value this method read itself, so without this the caller's
    // `expectedVersion` would never actually be tested against the row.
    if (before.updatedAt.getTime() !== expected.getTime()) {
      throw new ConflictException(
        'This application was changed by someone else. Reload and try again.',
      );
    }

    // Refused before the write rather than discovered after it: revised terms
    // that produce no schedule cannot be approved, so they must not be stored.
    try {
      computeSchedule({
        principalPaise: before.requestedAmountPaise,
        annualRateBps: BigInt(dto.interestRateBps),
        interestType: dto.interestType,
        frequency: dto.repaymentFrequency,
        durationCount: dto.durationCount,
        startDate: toIsoDate(new Date()),
      });
    } catch (error) {
      if (error instanceof EmiCalculationError) {
        throw new BadRequestException(
          `The revised terms do not produce a repayment schedule: ${error.message}`,
        );
      }
      throw error;
    }

    await this.prisma.$transaction(async (tx) => {
      // The revised term must still be one the scheme offers — a reviewer may
      // reprice within the scheme, not invent a term outside it.
      await this.schemes.assertSelectable(
        tx,
        actor.orgId,
        before.loanSchemeId,
        dto.repaymentFrequency,
        dto.durationCount,
      );

      const guard = await tx.loanApplication.updateMany({
        where: {
          orgId: actor.orgId,
          applicationId,
          status: 'UNDER_REVIEW',
          updatedAt: before.updatedAt,
        },
        data: {
          interestType: dto.interestType,
          interestRateBps: BigInt(dto.interestRateBps),
          repaymentFrequency: dto.repaymentFrequency,
          durationCount: dto.durationCount,
          updatedBy: actor.userId,
        },
      });

      if (guard.count === 0) {
        throw new ConflictException(
          'This application was changed by someone else. Reload and try again.',
        );
      }

      await tx.loanApplicationReview.create({
        data: {
          orgId: actor.orgId,
          applicationId,
          reviewerId: actor.userId,
          reviewType: 'MODIFY_TERMS',
          decision: 'TERMS_MODIFIED',
          comments: dto.comments,
          // The terms as they stood before this change. Storing the previous
          // rather than the new values is what makes a separate submission
          // snapshot unnecessary.
          previousInterestType: before.interestType,
          previousInterestRateBps: before.interestRateBps,
          previousFrequency: before.repaymentFrequency,
          previousDurationCount: before.durationCount,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LOAN_APPLICATION_TERMS_MODIFIED,
          entityType: 'LOAN_APPLICATION',
          entityId: applicationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            interestType: before.interestType,
            interestRateBps: before.interestRateBps.toString(),
            repaymentFrequency: before.repaymentFrequency,
            durationCount: before.durationCount,
          },
          newData: {
            interestType: dto.interestType,
            interestRateBps: dto.interestRateBps,
            repaymentFrequency: dto.repaymentFrequency,
            durationCount: dto.durationCount,
          },
          metadata: { comments: dto.comments },
        },
        tx,
      );
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * T8: UNDER_REVIEW -> APPROVED (Scenario 25).
   *
   * # The three gates
   *
   * 1. **EMI** — recomputed from the application's current terms and refused if
   *    it does not resolve. Rule 68 enforced independently of Modify Terms:
   *    approval fails closed rather than trusting that whoever last touched the
   *    terms checked them.
   * 2. **Documents** (Scenario 6, Rule 25) — every mandatory document present
   *    and not rejected. Submit already checked this, but a verifier can mark a
   *    document REJECTED *after* submission, which reopens the requirement
   *    without reopening the application.
   * 3. **Credit assessment** (Scenarios 8, 9) — a current assessment that
   *    passed. A FAIL or a MANUAL_REVIEW blocks; see
   *    `CreditAssessmentService.assertApprovable`.
   *
   * Each gate runs twice: once before the transaction, where it produces the
   * actionable message and the block audit, and once inside it via
   * `inTransaction`, where it makes the check and the write atomic (Rule 48).
   * The outer pass alone would let a document rejected between the check and
   * the write slip through — the same reason submit runs completeness inside
   * its own transaction.
   *
   * # Scenario 13 needs no gate
   *
   * "Outstanding More Info blocks approval" is structural: MORE_INFO_REQUIRED is
   * not in `from`, so such an application cannot be approved at all and lands in
   * the illegal-transition branch with its own audit record.
   *
   * Approval does not disburse and does not create a loan (Rules 42, 47, 48;
   * Scenario 30). The next step is the sanction letter, in `LoanSanctionService`.
   */
  async approve(
    actor: AuthContext,
    applicationId: string,
    dto: ApproveApplicationDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    if (before.status === 'UNDER_REVIEW') {
      this.assertEmiComputes(before);

      const missing = await this.completeness.missingDocuments(
        this.prisma,
        before,
      );

      if (missing.length > 0) {
        await this.recordApproveBlocked(
          actor,
          before,
          meta,
          'DOCUMENTS_MISSING',
          {
            missingDocumentTypes: missing,
          },
        );

        throw new ConflictException({
          message:
            'This application cannot be approved while mandatory documents are outstanding',
          blocker: 'DOCUMENTS',
          reason: 'DOCUMENTS_MISSING',
          missingDocumentTypes: missing,
        });
      }

      await this.assessments.assertApprovable(
        this.prisma,
        actor.orgId,
        applicationId,
        (reason, details) =>
          this.recordApproveBlocked(actor, before, meta, reason, details),
      );
    }

    await this.transition(actor, before, dto.expectedVersion, meta, {
      from: ['UNDER_REVIEW'],
      to: 'APPROVED',
      action: AuditAction.LOAN_APPLICATION_APPROVED,
      data: { approvedAt: new Date(), approvedBy: actor.userId },
      review: {
        reviewType: 'FINAL_APPROVAL',
        decision: 'APPROVED',
        comments: dto.comments ?? null,
      },
      // The authoritative pass. The pre-checks above own the error messages;
      // these own the guarantee that nothing changed underneath them.
      inTransaction: async (tx) => {
        const missing = await this.completeness.missingDocuments(tx, before);

        if (missing.length > 0) {
          throw new ConflictException({
            message:
              'This application cannot be approved while mandatory documents are outstanding',
            blocker: 'DOCUMENTS',
            reason: 'DOCUMENTS_MISSING',
            missingDocumentTypes: missing,
          });
        }

        await this.assessments.assertApprovable(
          tx,
          actor.orgId,
          before.applicationId,
        );
      },
    });

    // Module 16. After commit (Rules 60-62): the decision stands whether or not
    // anyone is told about it.
    await this.emitDecision('APPROVAL_APPROVED', actor, before, meta, {
      comments: dto.comments ?? '',
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * Everything standing between an application and approval (Scenarios 6, 13).
   *
   * Read-only and advisory — `approve` re-runs every one of these. It exists so
   * the reviewer's screen can show what is outstanding *before* they press the
   * button, which is what "the missing requirements are displayed" asks for.
   *
   * Deliberately not folded into `ApplicationCompleteness`: that answers "could
   * this be submitted" and is rendered by the wizard, which has no business
   * showing an approval blocker.
   */
  async approvalReadiness(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<ApprovalReadiness> {
    const application = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    const blockers: ApprovalBlocker[] = [];

    if (application.status !== 'UNDER_REVIEW') {
      blockers.push({
        key: 'STATUS',
        reason:
          application.status === 'MORE_INFO_REQUIRED'
            ? 'Requested information is still outstanding'
            : `An application that is ${application.status} cannot be approved`,
        details: { status: application.status },
      });
    }

    try {
      this.assertEmiComputes(application);
    } catch (error) {
      blockers.push({
        key: 'EMI',
        reason:
          error instanceof ConflictException
            ? 'The current terms produce no repayment schedule'
            : 'The repayment schedule could not be calculated',
      });
    }

    const missing = await this.completeness.missingDocuments(
      this.prisma,
      application,
    );

    if (missing.length > 0) {
      blockers.push({
        key: 'DOCUMENTS',
        reason: 'Mandatory documents are outstanding',
        details: { missingDocumentTypes: missing },
      });
    }

    const assessment = await this.assessments.currentFor(
      this.prisma,
      actor.orgId,
      applicationId,
    );

    if (!assessment) {
      blockers.push({
        key: 'ASSESSMENT',
        reason: 'No credit assessment has been recorded',
      });
    } else if (!assessment.assessmentResult) {
      blockers.push({
        key: 'ASSESSMENT',
        reason: 'The credit assessment is incomplete',
      });
    } else if (assessment.assessmentResult !== 'PASS') {
      blockers.push({
        key: 'ASSESSMENT',
        reason:
          assessment.assessmentResult === 'FAIL'
            ? 'The credit assessment failed'
            : 'The credit assessment needs manual review',
        details: { assessmentResult: assessment.assessmentResult },
      });
    }

    return {
      applicationId,
      approvable: blockers.length === 0,
      blockers,
      assessment: assessment ? toAssessmentDetail(assessment) : null,
      version: application.updatedAt.toISOString(),
    };
  }

  /** Rule 68. Throws a 409 when the current terms produce no schedule. */
  private assertEmiComputes(application: ApplicationWithRelations): void {
    try {
      computeSchedule({
        principalPaise: application.requestedAmountPaise,
        annualRateBps: application.interestRateBps,
        interestType: application.interestType,
        frequency: application.repaymentFrequency,
        durationCount: application.durationCount,
        startDate: toIsoDate(application.submittedAt ?? application.createdAt),
      });
    } catch (error) {
      if (error instanceof EmiCalculationError) {
        throw new ConflictException(
          `This application cannot be approved: its terms produce no repayment schedule (${error.message})`,
        );
      }
      throw error;
    }
  }

  /** Scenarios 6, 8, 9 — an approval refused by a gate is part of the record. */
  private async recordApproveBlocked(
    actor: AuthContext,
    before: ApplicationWithRelations,
    meta: RequestMeta,
    reason: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_APPROVE_BLOCKED,
      entityType: 'LOAN_APPLICATION',
      entityId: before.applicationId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason, status: before.status, ...details },
    });
  }

  /**
   * T9/T10: UNDER_REVIEW or SUBMITTED -> REJECTED (Scenarios 26, 27).
   *
   * SUBMITTED is a legitimate source: rejecting without a review pass is a real
   * outcome, and forcing a reviewer to claim an application before refusing it
   * would be ceremony rather than control.
   *
   * The reason is mandatory at the DTO level and stored on the row, because the
   * unified REJECTED status carries no information on its own (Rules 39, 40).
   */
  async reject(
    actor: AuthContext,
    applicationId: string,
    dto: RejectApplicationDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    await this.transition(actor, before, dto.expectedVersion, meta, {
      from: ['UNDER_REVIEW', 'SUBMITTED'],
      to: 'REJECTED',
      action: AuditAction.LOAN_APPLICATION_REJECTED,
      data: { rejectionReason: dto.rejectionReason },
      review: {
        reviewType: 'FINAL_APPROVAL',
        decision: 'REJECTED',
        comments: dto.comments ?? null,
        rejectionReason: dto.rejectionReason,
      },
      metadata: { rejectionReason: dto.rejectionReason },
    });

    await this.emitDecision('APPROVAL_REJECTED', actor, before, meta, {
      rejectionReason: dto.rejectionReason,
      comments: dto.comments ?? '',
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * Raise one approval-decision notification event, after the decision has
   * committed.
   *
   * Shared by approve, reject and request-more-info because all three carry the
   * same identity and differ only in the extra fields they add. Written once so
   * the money and date conventions cannot drift between them: every amount is a
   * decimal string of paise (Rule 25) and the emitter formats rather than
   * computes (Rule 27).
   *
   * `sourceVersion` is the application's `updatedAt` at the moment of the
   * decision, which is what distinguishes a genuine second decision on the same
   * application from a replay of this one (Rules 12, 14).
   */
  private async emitDecision(
    eventType: string,
    actor: AuthContext,
    before: {
      applicationId: string;
      applicationNumber: string;
      branchId: string;
      requestedAmountPaise: bigint;
      updatedAt: Date;
      customer?: { fullName: string } | null;
    },
    meta: RequestMeta,
    extra: Record<string, string> = {},
  ): Promise<void> {
    await this.events
      .emit(
        {
          orgId: actor.orgId,
          branchId: before.branchId,
          eventType,
          sourceModule: 'approval',
          sourceRecordId: before.applicationId,
          sourceVersion: before.updatedAt.toISOString(),
          payload: {
            applicationNumber: before.applicationNumber,
            customerName: before.customer?.fullName ?? '',
            amountPaise: before.requestedAmountPaise.toString(),
            amountFormatted: formatPaise(
              before.requestedAmountPaise.toString(),
            ),
            ...extra,
          },
        },
        meta,
      )
      .catch(() => undefined);
  }

  /**
   * The append-only review history, oldest first (Scenario 60).
   *
   * Ordered ascending so a reader replaying it sees the terms evolve forward;
   * the earliest MODIFY_TERMS row's `previous*` values are the originally
   * submitted terms.
   */
  async history(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<LoanApplicationHistoryEntry[]> {
    await this.applications.findInScope(actor, applicationId, meta);

    const rows = await this.prisma.loanApplicationReview.findMany({
      where: { orgId: actor.orgId, applicationId },
      orderBy: { createdAt: 'asc' },
    });

    const reviewerIds = [...new Set(rows.map((row) => row.reviewerId))];
    const reviewers = await this.prisma.user.findMany({
      where: { orgId: actor.orgId, userId: { in: reviewerIds } },
      // `name`, not `fullName`: that is the Customer and Guarantor field. The
      // two are easy to confuse and the compiler is the only thing that notices.
      select: { userId: true, name: true },
    });

    const names = new Map(reviewers.map((user) => [user.userId, user.name]));

    return (rows as unknown as ReviewRow[]).map((row) =>
      toHistoryEntry(row, names.get(row.reviewerId) ?? 'Unknown reviewer'),
    );
  }

  /**
   * Delegates to the shared primitive. Kept as a private method so the call
   * sites above read unchanged.
   */
  private async transition(
    actor: AuthContext,
    before: ApplicationWithRelations,
    expectedVersion: string,
    meta: RequestMeta,
    spec: TransitionSpec,
  ): Promise<void> {
    await this.transitions.run(actor, before, expectedVersion, meta, spec);
  }
}
