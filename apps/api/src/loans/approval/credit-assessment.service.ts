import { ConflictException, Injectable } from '@nestjs/common';
import type {
  CreditAssessmentDetail,
  CreditAssessmentHistory,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordCreditAssessmentDto } from '../applications/dto/loan-application.dto';
import { LoanApplicationService } from '../applications/loan-application.service';

export const APPLICATIONS_ASSESSMENT_VIEW_PERMISSION =
  'loans.applications.assessment.view';
export const APPLICATIONS_ASSESSMENT_RECORD_PERMISSION =
  'loans.applications.assessment.record';

/** The statuses during which an assessment may be recorded. */
const ASSESSABLE_STATUSES = ['UNDER_REVIEW', 'MORE_INFO_REQUIRED'];

export type AssessmentRow = {
  assessmentId: string;
  applicationId: string;
  cibilScore: number | null;
  incomeVerified: boolean | null;
  incomeMonthlyPaise: bigint | null;
  assessmentResult: 'PASS' | 'FAIL' | 'MANUAL_REVIEW' | null;
  assessmentNotes: string | null;
  assessedBy: string | null;
  assessedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
};

/** Why an application is not approvable on assessment grounds. */
export type AssessmentBlockReason =
  'ASSESSMENT_MISSING' | 'ASSESSMENT_INCOMPLETE' | 'ASSESSMENT_NOT_PASSED';

export function toAssessmentDetail(
  row: AssessmentRow,
  assessorName?: string,
): CreditAssessmentDetail {
  return {
    assessmentId: row.assessmentId,
    applicationId: row.applicationId,
    ...(row.cibilScore !== null ? { cibilScore: row.cibilScore } : {}),
    ...(row.incomeVerified !== null
      ? { incomeVerified: row.incomeVerified }
      : {}),
    ...(row.incomeMonthlyPaise !== null
      ? { incomeMonthlyPaise: row.incomeMonthlyPaise.toString() }
      : {}),
    ...(row.assessmentResult ? { assessmentResult: row.assessmentResult } : {}),
    ...(row.assessmentNotes ? { assessmentNotes: row.assessmentNotes } : {}),
    ...(row.assessedBy ? { assessedBy: row.assessedBy } : {}),
    ...(assessorName ? { assessorName } : {}),
    ...(row.assessedAt ? { assessedAt: row.assessedAt.toISOString() } : {}),
    ...(row.supersededAt
      ? { supersededAt: row.supersededAt.toISOString() }
      : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Module 08 — credit assessment (CIBIL and income check, Rule 2, Scenario 7).
 *
 * # Why this is not part of `LoanApplicationCompletenessService`
 *
 * Three reasons, and each one on its own would be enough:
 *
 * 1. Completeness answers "could this application be *submitted*". Assessment
 *    answers "may this application be *approved*". Merging them would put a
 *    CREDIT_ASSESSMENT tick on the wizard's step 6 that the branch filling in
 *    the wizard cannot possibly satisfy.
 * 2. Completeness is a pure evaluation over rows the caller already holds.
 *    Assessment is a mutable, permissioned, separately audited record.
 * 3. `ApplicationCompleteness.checks` is a shipped API contract the web renders.
 *    Adding a key would change the shape of a screen that has nothing to do
 *    with approval.
 *
 * # Supersession is the override
 *
 * Recording an assessment supersedes the previous one rather than editing it,
 * so a decision taken against an earlier finding stays reconstructable. That is
 * also the whole answer to "can a credit assessment be overridden, by whom, and
 * does it need a second approval" (Q-APP-26/27/28): a reviewer who disagrees
 * with a MANUAL_REVIEW records a fresh PASS with notes, and the superseded row
 * is the audit trail. No override concept, no second approval, no hierarchy —
 * Rule 21 forbids inventing one.
 */
@Injectable()
export class CreditAssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: LoanApplicationService,
  ) {}

  /**
   * The current assessment and every superseded one (Scenario 7).
   *
   * Scope resolves through the application, so an out-of-branch id is a 404
   * before any assessment row is read — a CIBIL score must not be reachable by
   * an id the caller could not otherwise see.
   */
  async list(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<CreditAssessmentHistory> {
    await this.applications.findInScope(actor, applicationId, meta);

    const rows = (await this.prisma.creditAssessment.findMany({
      where: { orgId: actor.orgId, applicationId },
      orderBy: { createdAt: 'desc' },
    })) as unknown as AssessmentRow[];

    const assessorIds = [
      ...new Set(rows.map((row) => row.assessedBy).filter(Boolean)),
    ] as string[];

    const assessors = await this.prisma.user.findMany({
      where: { orgId: actor.orgId, userId: { in: assessorIds } },
      // `name`, not `fullName`: that is the Customer and Guarantor field.
      select: { userId: true, name: true },
    });

    const names = new Map(assessors.map((user) => [user.userId, user.name]));
    const detail = (row: AssessmentRow) =>
      toAssessmentDetail(
        row,
        row.assessedBy ? names.get(row.assessedBy) : undefined,
      );

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_CREDIT_ASSESSMENT_VIEWED,
      entityType: 'LOAN_APPLICATION',
      entityId: applicationId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const current = rows.find((row) => row.supersededAt === null) ?? null;

    return {
      applicationId,
      current: current ? detail(current) : null,
      superseded: rows
        .filter((row) => row.supersededAt !== null)
        .map((row) => detail(row)),
    };
  }

  /**
   * Records an assessment, superseding whatever was current (Scenarios 7, 9).
   *
   * # It deliberately does not touch the application's `updatedAt`
   *
   * Recording an assessment is not a lifecycle transition, and bumping the
   * version would invalidate an approve form a reviewer already has open for no
   * reason the reviewer could understand.
   *
   * The staleness that *does* matter — approving against an assessment that has
   * since been superseded — is closed by `assertApprovable` re-reading the
   * current row inside approve's own transaction. The re-read is the mechanism;
   * a version bump here would be a worse one, because it would also fire on
   * changes that do not affect approvability.
   */
  async record(
    actor: AuthContext,
    applicationId: string,
    dto: RecordCreditAssessmentDto,
    meta: RequestMeta,
  ): Promise<CreditAssessmentDetail> {
    const application = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    if (!ASSESSABLE_STATUSES.includes(application.status)) {
      throw new ConflictException(
        `A credit assessment can only be recorded while an application is under review; this one is ${application.status}`,
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const superseded = await tx.creditAssessment.updateMany({
        where: { orgId: actor.orgId, applicationId, supersededAt: null },
        data: { supersededAt: now },
      });

      const created = (await tx.creditAssessment.create({
        data: {
          orgId: actor.orgId,
          applicationId,
          cibilScore: dto.cibilScore ?? null,
          incomeVerified: dto.incomeVerified,
          incomeMonthlyPaise: dto.incomeMonthlyPaise
            ? BigInt(dto.incomeMonthlyPaise)
            : null,
          assessmentResult: dto.assessmentResult,
          assessmentNotes: dto.assessmentNotes ?? null,
          // From the actor, never from the DTO: a client that could name the
          // assessor could attribute a finding to someone who never made it.
          assessedBy: actor.userId,
          assessedAt: now,
        },
      })) as unknown as AssessmentRow;

      if (superseded.count > 0) {
        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_CREDIT_ASSESSMENT_SUPERSEDED,
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { supersededCount: superseded.count },
          },
          tx,
        );
      }

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LOAN_CREDIT_ASSESSMENT_RECORDED,
          entityType: 'LOAN_APPLICATION',
          entityId: applicationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          newData: {
            assessmentResult: dto.assessmentResult,
            cibilScore: dto.cibilScore ?? null,
            incomeVerified: dto.incomeVerified,
          },
        },
        tx,
      );

      return toAssessmentDetail(created);
    });
  }

  /** The one current assessment for an application, or null. */
  async currentFor(
    tx: Pick<PrismaService, 'creditAssessment'>,
    orgId: string,
    applicationId: string,
  ): Promise<AssessmentRow | null> {
    const row = await tx.creditAssessment.findFirst({
      where: { orgId, applicationId, supersededAt: null },
    });

    return row ?? null;
  }

  /**
   * The approval gate (Scenarios 8, 9). Returns the current assessment, or
   * throws with the reason approval is blocked.
   *
   * Takes a `tx` so `approve` can run it inside the transaction that writes
   * APPROVED — the same reason `LoanApplicationCompletenessService.evaluate`
   * takes one, and the reason a superseded assessment cannot slip past between
   * the check and the write.
   *
   * # MANUAL_REVIEW blocks as firmly as FAIL
   *
   * MANUAL_REVIEW means "a human must decide", and Scenario 9's whole point is
   * that an unresolved check does not become a pass by being ambiguous. A
   * reviewer who *has* decided records a fresh PASS with notes; the
   * MANUAL_REVIEW row survives as superseded, which is what makes that decision
   * auditable. Treating it as a pass here would delete that step.
   */
  async assertApprovable(
    tx: Pick<PrismaService, 'creditAssessment'>,
    orgId: string,
    applicationId: string,
    onBlocked?: (
      reason: AssessmentBlockReason,
      details: Record<string, unknown>,
    ) => Promise<void>,
  ): Promise<AssessmentRow> {
    const current = await this.currentFor(tx, orgId, applicationId);

    const block = async (
      reason: AssessmentBlockReason,
      message: string,
      details: Record<string, unknown> = {},
    ): Promise<never> => {
      await onBlocked?.(reason, details);
      throw new ConflictException({
        message,
        blocker: 'ASSESSMENT',
        reason,
        ...details,
      });
    };

    if (!current) {
      return block(
        'ASSESSMENT_MISSING',
        'This application cannot be approved before a credit assessment is recorded',
      );
    }

    if (!current.assessmentResult) {
      return block(
        'ASSESSMENT_INCOMPLETE',
        'This application cannot be approved while its credit assessment is incomplete',
      );
    }

    if (current.assessmentResult !== 'PASS') {
      return block(
        'ASSESSMENT_NOT_PASSED',
        current.assessmentResult === 'FAIL'
          ? 'This application cannot be approved: its credit assessment failed'
          : 'This application cannot be approved: its credit assessment needs manual review. Record a fresh assessment to proceed.',
        { assessmentResult: current.assessmentResult },
      );
    }

    return current;
  }
}
