import { computeSchedule, EmiCalculationError } from '@lms/emi';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoanApplicationDetail, SanctionLetterDetail } from '@lms/types';

import { AuditAction } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplicationTransitionService,
  type TransitionTx,
} from '../applications/application-transition.service';
import {
  AcceptSanctionDto,
  DeclineSanctionDto,
  IssueSanctionDto,
  RecordAgreementDto,
} from '../applications/dto/loan-application.dto';
import { LoanApplicationService } from '../applications/loan-application.service';
import {
  toIsoDate,
  type ApplicationWithRelations,
} from '../applications/loan-application.mapper';

export const APPLICATIONS_SANCTION_ISSUE_PERMISSION =
  'loans.applications.sanction.issue';
export const APPLICATIONS_SANCTION_RECORD_RESPONSE_PERMISSION =
  'loans.applications.sanction.record_response';
export const APPLICATIONS_AGREEMENT_RECORD_PERMISSION =
  'loans.applications.agreement.record';

const STALE =
  'This application was changed by someone else. Reload and try again.';

type SanctionLetterRow = {
  sanctionLetterId: string;
  applicationId: string;
  sanctionNumber: string;
  sanctionedAmountPaise: bigint;
  interestType: 'FLAT' | 'REDUCING';
  interestRateBps: bigint;
  repaymentFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  durationCount: number;
  installmentAmountPaise: bigint;
  totalPayablePaise: bigint;
  issuedAt: Date;
  issuedBy: string;
  validUntil: Date | null;
  notes: string | null;
  customerResponse: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  customerRespondedAt: Date | null;
  responseRecordedBy: string | null;
  declineReason: string | null;
  agreementSignedAt: Date | null;
  agreementReference: string | null;
  updatedAt: Date;
};

function toSanctionDetail(
  row: SanctionLetterRow,
  issuerName?: string,
): SanctionLetterDetail {
  return {
    sanctionLetterId: row.sanctionLetterId,
    applicationId: row.applicationId,
    sanctionNumber: row.sanctionNumber,
    sanctionedAmountPaise: row.sanctionedAmountPaise.toString(),
    interestType: row.interestType,
    interestRateBps: row.interestRateBps.toString(),
    repaymentFrequency: row.repaymentFrequency,
    durationCount: row.durationCount,
    installmentAmountPaise: row.installmentAmountPaise.toString(),
    totalPayablePaise: row.totalPayablePaise.toString(),
    issuedAt: row.issuedAt.toISOString(),
    issuedBy: row.issuedBy,
    ...(issuerName ? { issuerName } : {}),
    ...(row.validUntil ? { validUntil: toIsoDate(row.validUntil) } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    customerResponse: row.customerResponse,
    ...(row.customerRespondedAt
      ? { customerRespondedAt: row.customerRespondedAt.toISOString() }
      : {}),
    ...(row.responseRecordedBy
      ? { responseRecordedBy: row.responseRecordedBy }
      : {}),
    ...(row.declineReason ? { declineReason: row.declineReason } : {}),
    ...(row.agreementSignedAt
      ? { agreementSignedAt: row.agreementSignedAt.toISOString() }
      : {}),
    ...(row.agreementReference
      ? { agreementReference: row.agreementReference }
      : {}),
    version: row.updatedAt.toISOString(),
  };
}

/**
 * Module 08 — the lifecycle after approval.
 *
 * ```
 * APPROVED --issue--> SANCTIONED --accept--> CUSTOMER_ACCEPTED --sign--> AGREEMENT_SIGNED
 *                          |
 *                       decline
 *                          v
 *                      REJECTED
 * ```
 *
 * # Why a decline is REJECTED and not CUSTOMER_REJECTED
 *
 * Rule 13 unifies "Application Rejected" and "Loan Rejected" into one REJECTED
 * status with a separate reason, and the Acceptance Criteria repeat it. The
 * Prisma enum does carry a CUSTOMER_REJECTED value, written speculatively from
 * the lifecycle diagram, and nothing has ever set it.
 *
 * Using it would fork every consumer of `status === 'REJECTED'` — the list
 * filter, the badge, the "already decided" refusal — which is precisely the
 * drift Rule 13 exists to prevent. Instead the decline reason lands on the
 * application's `rejectionReason` (the unified status carries no information on
 * its own, Rule 40) and the review row's SANCTION reviewType is what
 * distinguishes a customer's decline from an admin's rejection.
 *
 * # Notifications
 *
 * Rules 49-52 want SMS and App Push to Customer and Branch Admin on approval,
 * rejection and sanction, logged and retried. Module 16 owns delivery; every
 * point one would fire already writes an audit record, and those records are
 * what a notification engine will read. Nothing here sends anything, and
 * nothing here may fail a transition because a message failed (Rule 49).
 */
@Injectable()
export class LoanSanctionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: LoanApplicationService,
    private readonly transitions: ApplicationTransitionService,
  ) {}

  /** The letter for an application, or a 404. Scope resolves through the application. */
  async get(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<SanctionLetterDetail> {
    await this.applications.findInScope(actor, applicationId, meta);

    const row = (await this.prisma.sanctionLetter.findFirst({
      where: { orgId: actor.orgId, applicationId },
    })) as unknown as SanctionLetterRow | null;

    if (!row) {
      throw new NotFoundException(
        'No sanction letter has been issued for this application',
      );
    }

    const issuer = await this.prisma.user.findFirst({
      where: { orgId: actor.orgId, userId: row.issuedBy },
      select: { name: true },
    });

    return toSanctionDetail(row, issuer?.name);
  }

  /**
   * T11: APPROVED -> SANCTIONED (Scenarios 30, 31).
   *
   * The letter's terms are snapshotted from the application rather than taken
   * from the caller. That is what makes "can sanctioned terms differ from
   * approved terms" (Q-APP-70) answer itself — they cannot, so the re-approval
   * question behind Q-APP-71 never arises.
   *
   * Scenario 31 ("sanction cannot bypass approval") needs no code beyond
   * `from: ['APPROVED']`: an application still under review lands in the
   * illegal-transition branch and is audited there.
   */
  async issue(
    actor: AuthContext,
    applicationId: string,
    dto: IssueSanctionDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    // Computed before the transaction: terms that resolve to no schedule must
    // refuse the sanction rather than store a letter with no installment.
    const schedule = this.computeOrRefuse(before);

    await this.transitions.run(actor, before, dto.expectedVersion, meta, {
      from: ['APPROVED'],
      to: 'SANCTIONED',
      action: AuditAction.LOAN_APPLICATION_SANCTIONED,
      data: { sanctionedAt: new Date() },
      review: {
        reviewType: 'SANCTION',
        decision: 'SANCTIONED',
        comments: dto.notes ?? null,
      },
      inTransaction: async (tx) => {
        const sanctionNumber = await this.nextSanctionNumber(tx, actor.orgId);

        await tx.sanctionLetter.create({
          data: {
            orgId: actor.orgId,
            applicationId: before.applicationId,
            sanctionNumber,
            sanctionedAmountPaise: before.requestedAmountPaise,
            interestType: before.interestType,
            interestRateBps: before.interestRateBps,
            repaymentFrequency: before.repaymentFrequency,
            durationCount: before.durationCount,
            installmentAmountPaise: schedule.installmentAmountPaise,
            totalPayablePaise: schedule.totalPayablePaise,
            issuedBy: actor.userId,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
            notes: dto.notes ?? null,
          },
        });
      },
      metadata: { validUntil: dto.validUntil ?? null },
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /** T12: SANCTIONED -> CUSTOMER_ACCEPTED (Scenario 33). */
  async accept(
    actor: AuthContext,
    applicationId: string,
    dto: AcceptSanctionDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    const respondedAt = new Date();

    await this.transitions.run(actor, before, dto.expectedVersion, meta, {
      from: ['SANCTIONED'],
      to: 'CUSTOMER_ACCEPTED',
      action: AuditAction.LOAN_SANCTION_ACCEPTED,
      data: { customerRespondedAt: respondedAt },
      review: {
        reviewType: 'SANCTION',
        decision: 'CUSTOMER_ACCEPTED',
        comments: dto.comments ?? null,
      },
      inTransaction: (tx) =>
        this.recordResponse(tx, actor, applicationId, {
          customerResponse: 'ACCEPTED',
          customerRespondedAt: respondedAt,
          responseRecordedBy: actor.userId,
        }),
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * T13: SANCTIONED -> REJECTED (Scenario 32).
   *
   * Not CUSTOMER_REJECTED — see the class comment. The decline reason becomes
   * the application's rejection reason so the unified status stays informative.
   */
  async decline(
    actor: AuthContext,
    applicationId: string,
    dto: DeclineSanctionDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    const respondedAt = new Date();

    await this.transitions.run(actor, before, dto.expectedVersion, meta, {
      from: ['SANCTIONED'],
      to: 'REJECTED',
      action: AuditAction.LOAN_SANCTION_DECLINED,
      data: {
        customerRespondedAt: respondedAt,
        rejectionReason: dto.declineReason,
      },
      review: {
        reviewType: 'SANCTION',
        decision: 'REJECTED',
        comments: dto.comments ?? null,
        rejectionReason: dto.declineReason,
      },
      inTransaction: (tx) =>
        this.recordResponse(tx, actor, applicationId, {
          customerResponse: 'DECLINED',
          customerRespondedAt: respondedAt,
          responseRecordedBy: actor.userId,
          declineReason: dto.declineReason,
        }),
      metadata: {
        declineReason: dto.declineReason,
        source: 'CUSTOMER_DECLINE',
      },
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * T14: CUSTOMER_ACCEPTED -> AGREEMENT_SIGNED (Scenarios 33, 34).
   *
   * A recorded fact, not a generated or electronically signed document
   * (Q-APP-75/76/77). `signedDate` is optional because a physically signed
   * agreement often arrives days after it was signed.
   *
   * Scenario 34 — "signed agreement remains required before disbursement" — is
   * Module 09's to enforce by refusing to disburse from anything but this
   * status. Producing the status is this module's whole contribution.
   */
  async recordAgreement(
    actor: AuthContext,
    applicationId: string,
    dto: RecordAgreementDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.applications.findInScope(
      actor,
      applicationId,
      meta,
    );

    const signedAt = dto.signedDate
      ? new Date(`${dto.signedDate}T12:00:00+05:30`)
      : new Date();

    await this.transitions.run(actor, before, dto.expectedVersion, meta, {
      from: ['CUSTOMER_ACCEPTED'],
      to: 'AGREEMENT_SIGNED',
      action: AuditAction.LOAN_AGREEMENT_SIGNED,
      data: { agreementSignedAt: signedAt },
      review: {
        reviewType: 'SANCTION',
        decision: 'AGREEMENT_SIGNED',
        comments: dto.comments ?? null,
      },
      inTransaction: async (tx) => {
        const updated = await tx.sanctionLetter.updateMany({
          where: {
            orgId: actor.orgId,
            applicationId,
            agreementSignedAt: null,
          },
          data: {
            agreementSignedAt: signedAt,
            agreementSignedRecordedBy: actor.userId,
            agreementReference: dto.agreementReference ?? null,
          },
        });

        if (updated.count === 0) throw new ConflictException(STALE);
      },
      metadata: { agreementReference: dto.agreementReference ?? null },
    });

    return this.applications.getById(actor, applicationId, meta);
  }

  /**
   * The letter's own guard, run inside the transition's transaction.
   *
   * The application's status guard would normally have caught a second response
   * already, but the letter and the application must not be able to disagree:
   * if one of them ever admits a write the other refuses, the pair stops being
   * a record of the same event.
   */
  private async recordResponse(
    tx: TransitionTx,
    actor: AuthContext,
    applicationId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const updated = await tx.sanctionLetter.updateMany({
      where: {
        orgId: actor.orgId,
        applicationId,
        customerResponse: 'PENDING',
      },
      data,
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'A response has already been recorded for this sanction letter.',
      );
    }
  }

  private computeOrRefuse(application: ApplicationWithRelations): {
    installmentAmountPaise: bigint;
    totalPayablePaise: bigint;
  } {
    try {
      const schedule = computeSchedule({
        principalPaise: application.requestedAmountPaise,
        annualRateBps: application.interestRateBps,
        interestType: application.interestType,
        frequency: application.repaymentFrequency,
        durationCount: application.durationCount,
        startDate: toIsoDate(application.submittedAt ?? application.createdAt),
      });

      return {
        installmentAmountPaise: schedule.installmentAmountPaise,
        totalPayablePaise: schedule.totalPayablePaise,
      };
    } catch (error) {
      if (error instanceof EmiCalculationError) {
        throw new ConflictException(
          `A sanction letter cannot be issued: these terms produce no repayment schedule (${error.message})`,
        );
      }
      throw error;
    }
  }

  /**
   * Allocates the next sanction number for the organization.
   *
   * Reads every `SL-%` number, filters to the exact numeric shape and takes the
   * numeric maximum — never a lexical sort, which would rank `SL-ZZ04` above
   * `SL-000007` and then propose a number that already exists. Copied
   * deliberately from `nextApplicationNumber`; the unique index is the real
   * guarantee.
   */
  private async nextSanctionNumber(
    tx: Pick<TransitionTx, 'sanctionLetter'>,
    orgId: string,
  ): Promise<string> {
    const rows = await tx.sanctionLetter.findMany({
      where: { orgId, sanctionNumber: { startsWith: 'SL-' } },
      select: { sanctionNumber: true },
    });

    let highest = 0;
    for (const row of rows) {
      const match = /^SL-(\d+)$/.exec(row.sanctionNumber);
      if (!match?.[1]) continue;
      const value = Number.parseInt(match[1], 10);
      if (value > highest) highest = value;
    }

    return `SL-${String(highest + 1).padStart(6, '0')}`;
  }
}
