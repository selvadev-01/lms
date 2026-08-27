import { computeSchedule, EmiCalculationError } from '@lms/emi';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApplicationCompleteness,
  EmiScheduleView,
  LoanApplicationDetail,
  LoanApplicationSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CustomerService } from '../../customers/customer/customer.service';
import { BranchService } from '../../organizations/branch.service';
import { formatPaise } from '../../common/export/money-format';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLoanApplicationDto,
  EmiPreviewDto,
  ListLoanApplicationsDto,
  UpdateLoanApplicationDto,
} from './dto/loan-application.dto';
import { LoanApplicationCompletenessService } from './loan-application-completeness.service';
import {
  toApplicationSummary,
  toDocumentSummary,
  toEmiView,
  toIsoDate,
  type ApplicationDocumentRow,
  type ApplicationWithRelations,
} from './loan-application.mapper';
import { LoanSchemeService } from '../products/loan-scheme.service';

export const APPLICATIONS_VIEW_PERMISSION = 'loans.applications.view';
export const APPLICATIONS_CREATE_PERMISSION = 'loans.applications.create';
export const APPLICATIONS_SUBMIT_PERMISSION = 'loans.applications.submit';
export const APPLICATIONS_DELETE_DRAFT_PERMISSION =
  'loans.applications.delete_draft';
export const APPLICATIONS_OVERRIDE_RATE_PERMISSION =
  'loans.applications.override_rate';

const NOT_REACHABLE = 'Loan application not found';

/** Loaded on every read so the summary can name the customer, branch and scheme. */
const APPLICATION_INCLUDE = {
  customer: { select: { fullName: true, customerCode: true } },
  branch: { select: { name: true } },
  loanProduct: { select: { code: true, loanType: true } },
  loanScheme: { select: { code: true, name: true } },
} as const;

/**
 * Module 07 — Loan Applications.
 *
 * Covers the lifecycle from DRAFT through submission; the reviewer's half
 * (start-review, request-info, modify-terms, approve, reject) lives in
 * `LoanApplicationReviewService`, which owns the transition guard.
 *
 * Two rules shape everything here:
 *
 * 1. **Scope is derived, never accepted.** The branch is taken from the selected
 *    customer's own branch, and the customer is resolved through
 *    `CustomerService.findInScope` — the same definition Modules 04 and 05 use.
 *    So a caller cannot create an application for a customer they cannot see,
 *    and there is no `branchId` parameter that could say otherwise (Scenarios
 *    41-43).
 *
 * 2. **Scheme terms are copied, not referenced.** Creation snapshots the
 *    scheme's interest type and rate onto the application. A later repricing
 *    therefore changes what new applications are offered and nothing else, which
 *    is the whole of Scenario 39.
 */
@Injectable()
export class LoanApplicationService {
  private readonly logger = new Logger(LoanApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
    private readonly branches: BranchService,
    private readonly schemes: LoanSchemeService,
    private readonly completeness: LoanApplicationCompletenessService,
    // Module 16, from the @Global NotificationEventsModule.
    private readonly events: NotificationEventsService,
  ) {}

  /** Scenarios 1, 3, 4. */
  async list(
    actor: AuthContext,
    query: ListLoanApplicationsDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationSummary[]> {
    const rows = await this.prisma.loanApplication.findMany({
      where: {
        orgId: actor.orgId,
        // The branch confinement. A Branch Admin's list cannot be widened by any
        // query parameter, which is what makes Scenario 3 structural.
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  applicationNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  customer: {
                    fullName: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
                {
                  customer: {
                    customerCode: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
        ...(query.fromDate || query.toDate
          ? {
              createdAt: {
                ...(query.fromDate
                  ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) }
                  : {}),
                // Exclusive upper bound on the next day, so a `toDate` of the
                // 19th includes everything on the 19th rather than only midnight.
                ...(query.toDate
                  ? { lt: new Date(`${query.toDate}T00:00:00.000Z`) }
                  : {}),
              },
            }
          : {}),
      },
      include: APPLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_LISTED,
      entityType: 'LOAN_APPLICATION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        returned: rows.length,
        scopedToBranch: actor.branchId,
        status: query.status ?? null,
      },
    });

    return (rows as unknown as ApplicationWithRelations[]).map(
      toApplicationSummary,
    );
  }

  /** Scenarios 2, 3, 4. */
  async getById(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const row = await this.findInScope(actor, applicationId, meta);

    const documents = await this.prisma.loanApplicationDocument.findMany({
      where: { orgId: actor.orgId, applicationId, supersededAt: null },
      orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_VIEWED,
      entityType: 'LOAN_APPLICATION',
      entityId: applicationId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      ...toApplicationSummary(row),
      branchName: row.branch.name,
      loanProductId: row.loanProductId,
      loanSchemeId: row.loanSchemeId,
      productCode: row.loanProduct.code,
      schemeCode: row.loanScheme.code,
      approvedAt: row.approvedAt?.toISOString(),
      approvedBy: row.approvedBy ?? undefined,
      sanctionedAt: row.sanctionedAt?.toISOString(),
      customerRespondedAt: row.customerRespondedAt?.toISOString(),
      agreementSignedAt: row.agreementSignedAt?.toISOString(),
      documents: (documents as unknown as ApplicationDocumentRow[]).map(
        toDocumentSummary,
      ),
      emi: toEmiView(row),
    };
  }

  /**
   * Stateless EMI preview for wizard step 4.
   *
   * Touches no stored record, so it needs no application to exist — which is
   * what lets the wizard show a schedule before anything is persisted (D-APP-1).
   * A calculation failure is a 400 here rather than a null result, because the
   * caller asked for a schedule and there isn't one.
   */
  preview(dto: EmiPreviewDto): EmiScheduleView {
    try {
      const schedule = computeSchedule({
        principalPaise: BigInt(dto.principalPaise),
        annualRateBps: BigInt(dto.annualRateBps),
        interestType: dto.interestType,
        frequency: dto.frequency,
        durationCount: dto.durationCount,
        startDate: dto.startDate ?? toIsoDate(new Date()),
      });

      return {
        installmentAmountPaise: schedule.installmentAmountPaise.toString(),
        finalInstallmentPaise: schedule.finalInstallmentPaise.toString(),
        totalPrincipalPaise: schedule.totalPrincipalPaise.toString(),
        totalInterestPaise: schedule.totalInterestPaise.toString(),
        totalPayablePaise: schedule.totalPayablePaise.toString(),
        installmentCount: schedule.installmentCount,
        firstDueDate: schedule.firstDueDate,
        lastDueDate: schedule.lastDueDate,
        installments: schedule.installments.map((installment) => ({
          installmentNumber: installment.installmentNumber,
          dueDate: installment.dueDate,
          principalPaise: installment.principalPaise.toString(),
          interestPaise: installment.interestPaise.toString(),
          totalPaise: installment.totalPaise.toString(),
          closingBalancePaise: installment.closingBalancePaise.toString(),
        })),
      };
    } catch (error) {
      if (error instanceof EmiCalculationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Creates a DRAFT from wizard steps 1-3 (Scenario 5, 13).
   *
   * The branch comes from the customer, never from the request. Combined with
   * `findInScope` resolving the customer under the caller's own scope, that
   * makes Scenarios 42 and 43 impossible to express rather than merely refused:
   * there is no parameter a client could set to place an application elsewhere.
   */
  async create(
    actor: AuthContext,
    dto: CreateLoanApplicationDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const customer = await this.customers.findInScope(
      actor,
      dto.customerId,
      meta,
    );

    if (customer.status !== 'ACTIVE') {
      await this.recordRejection(actor, meta, 'CUSTOMER_NOT_ACTIVE', {
        customerId: dto.customerId,
        status: customer.status,
      });
      throw new ConflictException(
        'This customer is not active and cannot take a new loan application',
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.branches.assertBranchOperational(
          tx,
          actor.orgId,
          customer.branchId,
        );

        // Validates the scheme and returns it, so the terms below are copied
        // from the row that was just checked rather than one read separately.
        const scheme = await this.schemes.assertSelectable(
          tx,
          actor.orgId,
          dto.loanSchemeId,
          dto.repaymentFrequency,
          dto.durationCount,
        );

        this.assertRateAllowed(
          actor,
          dto.interestType,
          BigInt(dto.interestRateBps),
          scheme.interestRateBps,
        );

        const applicationNumber = await this.nextApplicationNumber(
          tx,
          actor.orgId,
        );

        const row = await tx.loanApplication.create({
          data: {
            orgId: actor.orgId,
            applicationNumber,
            // From the customer, not the caller and not the request.
            branchId: customer.branchId,
            customerId: dto.customerId,
            loanProductId: scheme.loanProductId,
            loanSchemeId: dto.loanSchemeId,
            requestedAmountPaise: BigInt(dto.requestedAmountPaise),
            purpose: dto.purpose,
            // Snapshotted from the scheme's configuration at this instant. A
            // later repricing does not reach back into this row (Scenario 39).
            interestType: dto.interestType,
            interestRateBps: BigInt(dto.interestRateBps),
            repaymentFrequency: dto.repaymentFrequency,
            durationCount: dto.durationCount,
            status: 'DRAFT',
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_APPLICATION_CREATED,
            entityType: 'LOAN_APPLICATION',
            entityId: row.applicationId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              applicationNumber: row.applicationNumber,
              customerId: row.customerId,
              branchId: row.branchId,
              loanSchemeId: row.loanSchemeId,
              requestedAmountPaise: row.requestedAmountPaise.toString(),
              interestType: row.interestType,
              interestRateBps: row.interestRateBps.toString(),
              repaymentFrequency: row.repaymentFrequency,
              durationCount: row.durationCount,
              status: row.status,
            },
          },
          tx,
        );

        return row;
      });

      return this.getById(actor, created.applicationId, meta);
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'create', null);
      throw this.translateUniqueViolation(error);
    }
  }

  /**
   * Edits a draft (Scenario 14).
   *
   * Uses the read-then-write `assertVersion` idiom rather than the `updateMany`
   * guard the lifecycle transitions use. That is deliberate: on a DRAFT nobody
   * is reviewing, a lost update between two editors of the same draft is a
   * last-write-wins outcome the version check already reports. The transitions
   * need more because approve-versus-reject is a race with two *different*
   * outcomes, not two versions of the same one.
   */
  async update(
    actor: AuthContext,
    applicationId: string,
    dto: UpdateLoanApplicationDto,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.findInScope(actor, applicationId, meta);
    this.assertVersionMatches(before, dto.expectedVersion);

    // Rule 65 / Scenario 15: an application under review is not editable through
    // this path. Modify Terms is the reviewer's route and has its own permission.
    if (before.status !== 'DRAFT' && before.status !== 'MORE_INFO_REQUIRED') {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_APPLICATION_TRANSITION_REJECTED,
        entityType: 'LOAN_APPLICATION',
        entityId: applicationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason: 'NOT_EDITABLE', status: before.status },
      });
      throw new ConflictException(
        `An application that is ${before.status} can no longer be edited`,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const scheme = await this.schemes.assertSelectable(
          tx,
          actor.orgId,
          dto.loanSchemeId,
          dto.repaymentFrequency,
          dto.durationCount,
        );

        this.assertRateAllowed(
          actor,
          dto.interestType,
          BigInt(dto.interestRateBps),
          scheme.interestRateBps,
        );

        const row = await tx.loanApplication.update({
          where: { orgId_applicationId: { orgId: actor.orgId, applicationId } },
          data: {
            loanProductId: scheme.loanProductId,
            loanSchemeId: dto.loanSchemeId,
            requestedAmountPaise: BigInt(dto.requestedAmountPaise),
            purpose: dto.purpose,
            interestType: dto.interestType,
            interestRateBps: BigInt(dto.interestRateBps),
            repaymentFrequency: dto.repaymentFrequency,
            durationCount: dto.durationCount,
            updatedBy: actor.userId,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_APPLICATION_UPDATED,
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: {
              requestedAmountPaise: before.requestedAmountPaise.toString(),
              purpose: before.purpose,
              interestType: before.interestType,
              interestRateBps: before.interestRateBps.toString(),
              repaymentFrequency: before.repaymentFrequency,
              durationCount: before.durationCount,
            },
            newData: {
              requestedAmountPaise: row.requestedAmountPaise.toString(),
              purpose: row.purpose,
              interestType: row.interestType,
              interestRateBps: row.interestRateBps.toString(),
              repaymentFrequency: row.repaymentFrequency,
              durationCount: row.durationCount,
            },
          },
          tx,
        );
      });

      return this.getById(actor, applicationId, meta);
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'update',
        applicationId,
      );
      throw error;
    }
  }

  /** Wizard step 6's validation summary. Advisory — submit re-runs everything. */
  async completenessFor(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<ApplicationCompleteness> {
    const application = await this.findInScope(actor, applicationId, meta);
    const guarantors = await this.completeness.guarantorReadiness(
      actor,
      application.customerId,
      meta,
    );

    return this.completeness.evaluate(this.prisma, application, guarantors);
  }

  /**
   * Submits a draft for review (Scenarios 5, 21), or returns a MORE_INFO
   * application to the reviewer (Scenario 23).
   *
   * The completeness gate runs *inside* the transaction that writes the new
   * status. That is what makes Rule 72 hold — a scheme deactivated between the
   * wizard's step 6 and this call is caught, because the check and the write
   * cannot be separated by another transaction's commit.
   */
  async submit(
    actor: AuthContext,
    applicationId: string,
    expectedVersion: string,
    meta: RequestMeta,
  ): Promise<LoanApplicationDetail> {
    const before = await this.findInScope(actor, applicationId, meta);

    if (before.status !== 'DRAFT' && before.status !== 'MORE_INFO_REQUIRED') {
      throw new ConflictException(
        `An application that is ${before.status} cannot be submitted`,
      );
    }

    // Resolved outside the transaction: it does its own scope check and needs an
    // AuthContext, which a transaction-scoped client cannot supply.
    const guarantors = await this.completeness.guarantorReadiness(
      actor,
      before.customerId,
      meta,
    );

    // MORE_INFO returns straight to UNDER_REVIEW rather than to SUBMITTED: the
    // reviewer already has it, and sending it back to the unclaimed queue would
    // lose that (Scenario 23, transition T6).
    const nextStatus =
      before.status === 'MORE_INFO_REQUIRED' ? 'UNDER_REVIEW' : 'SUBMITTED';

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.branches.assertBranchOperational(
          tx,
          actor.orgId,
          before.branchId,
        );

        const completeness = await this.completeness.evaluate(
          tx,
          before,
          guarantors,
        );

        if (!completeness.submittable) {
          const failed = completeness.checks.filter(
            (check) => !check.satisfied,
          );

          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.LOAN_APPLICATION_SUBMIT_BLOCKED,
              entityType: 'LOAN_APPLICATION',
              entityId: applicationId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: { failed: failed.map((check) => check.key) },
            },
            tx,
          );

          throw new ConflictException({
            message: 'This application is not complete and cannot be submitted',
            checks: failed,
          });
        }

        // Status and version both in the WHERE: `updateMany` returns a count
        // rather than throwing, and a zero count is how a concurrent transition
        // is detected (Scenario 52).
        const guard = await tx.loanApplication.updateMany({
          where: {
            orgId: actor.orgId,
            applicationId,
            status: before.status,
            updatedAt: before.updatedAt,
          },
          data: {
            status: nextStatus,
            submittedAt: before.submittedAt ?? new Date(),
            updatedBy: actor.userId,
          },
        });

        if (guard.count === 0) {
          throw new ConflictException(
            'This application was changed by someone else. Reload and try again.',
          );
        }

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_APPLICATION_SUBMITTED,
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { status: before.status },
            newData: { status: nextStatus },
          },
          tx,
        );
      });

      // Module 16. After commit (Rules 60-62). Inside the `try` but after the
      // transaction, so a submission that failed to persist raises nothing —
      // Scenario 49 requires that a failed submission leave no trace of having
      // succeeded, and a notification would be exactly such a trace.
      await this.events
        .emit(
          {
            orgId: actor.orgId,
            branchId: before.branchId,
            eventType: 'APPLICATION_SUBMITTED',
            sourceModule: 'loan_application',
            sourceRecordId: applicationId,
            sourceVersion: before.updatedAt.toISOString(),
            payload: {
              applicationNumber: before.applicationNumber,
              customerName: before.customer?.fullName ?? '',
              amountPaise: before.requestedAmountPaise.toString(),
              amountFormatted: formatPaise(
                before.requestedAmountPaise.toString(),
              ),
              status: nextStatus,
            },
          },
          meta,
        )
        .catch(() => undefined);

      return this.getById(actor, applicationId, meta);
    } catch (error) {
      if (error instanceof ConflictException) throw error;

      // Scenario 49: a persistence failure must never leave a falsely submitted
      // application. The transaction guarantees it; this only records the attempt.
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'submit',
        applicationId,
      );
      throw error;
    }
  }

  /**
   * Deletes a DRAFT that nothing references (Scenario 36).
   *
   * Only DRAFT, and only with no documents or reviews. A submitted application
   * is never destructible (Scenarios 34, 35) — the source does not define
   * deletion of one, and its history is what an auditor would need.
   */
  async remove(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<{ applicationId: string; deleted: boolean }> {
    const before = await this.findInScope(actor, applicationId, meta);

    if (before.status !== 'DRAFT') {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_APPLICATION_DELETE_BLOCKED,
        entityType: 'LOAN_APPLICATION',
        entityId: applicationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason: 'NOT_DRAFT', status: before.status },
      });
      throw new ConflictException(
        'A submitted application cannot be deleted. Its history must be preserved.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Counted inside the transaction so a document uploaded between the check
      // and the delete cannot be orphaned.
      const [documents, reviews] = await Promise.all([
        tx.loanApplicationDocument.count({
          where: { orgId: actor.orgId, applicationId },
        }),
        tx.loanApplicationReview.count({
          where: { orgId: actor.orgId, applicationId },
        }),
      ]);

      if (documents > 0 || reviews > 0) {
        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_APPLICATION_DELETE_BLOCKED,
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { reason: 'HAS_REFERENCES', documents, reviews },
          },
          tx,
        );

        throw new ConflictException(
          'This draft has documents or review history and cannot be deleted.',
        );
      }

      await tx.loanApplication.delete({
        where: { orgId_applicationId: { orgId: actor.orgId, applicationId } },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LOAN_APPLICATION_DELETED,
          entityType: 'LOAN_APPLICATION',
          entityId: applicationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            applicationNumber: before.applicationNumber,
            status: before.status,
          },
        },
        tx,
      );
    });

    return { applicationId, deleted: true };
  }

  /**
   * Resolves an application the caller is entitled to reach, or refuses.
   *
   * Exported to the review and document services in this module so the scope
   * rule is written once. Both filters live in the query rather than in a
   * post-fetch check, so an out-of-scope application is never loaded at all.
   */
  async findInScope(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
  ): Promise<ApplicationWithRelations> {
    const row = await this.prisma.loanApplication.findFirst({
      where: {
        orgId: actor.orgId,
        applicationId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      include: APPLICATION_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_APPLICATION_SCOPE_DENIED,
        entityType: 'LOAN_APPLICATION',
        entityId: applicationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { actorBranchId: actor.branchId },
      });
      // 404 rather than 403: a 403 would confirm the id exists, which is the
      // disclosure Scenarios 3 and 4 are about.
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row as unknown as ApplicationWithRelations;
  }

  /**
   * Allocates the next application number for the organization.
   *
   * Reads every `APP-%` number, filters to the exact numeric shape and takes the
   * numeric maximum — never a lexical sort, which would put `APP-ZZ04` above
   * `APP-000007` and then propose a number that already exists. Runs inside the
   * caller's transaction; the unique index is the real guarantee.
   */
  private async nextApplicationNumber(
    tx: Pick<PrismaService, 'loanApplication'>,
    orgId: string,
  ): Promise<string> {
    const rows = await tx.loanApplication.findMany({
      where: { orgId, applicationNumber: { startsWith: 'APP-' } },
      select: { applicationNumber: true },
    });

    let highest = 0;
    for (const row of rows) {
      const match = /^APP-(\d+)$/.exec(row.applicationNumber);
      if (!match?.[1]) continue;
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > highest) highest = value;
    }

    return `APP-${String(highest + 1).padStart(6, '0')}`;
  }

  /**
   * A rate differing from the scheme's is an override, and needs the permission.
   *
   * Rules 53/54 and Q-APP-184/185: the scheme is the price list, so pricing off
   * it is a deliberate act rather than an edit. Enforced here rather than in the
   * DTO because it depends on the scheme, which the DTO cannot see.
   */
  private assertRateAllowed(
    actor: AuthContext,
    interestType: string,
    rateBps: bigint,
    schemeRateBps: bigint,
  ): void {
    if (rateBps === schemeRateBps) return;

    if (interestType !== 'CUSTOM_RATE') {
      throw new BadRequestException(
        'A rate that differs from the scheme requires the Custom Rate interest type',
      );
    }

    if (!actor.permissions.includes(APPLICATIONS_OVERRIDE_RATE_PERMISSION)) {
      throw new ConflictException(
        'You are not permitted to set a rate that differs from the scheme',
      );
    }
  }

  private assertVersionMatches(
    row: ApplicationWithRelations,
    expectedVersion: string,
  ): void {
    const parsed = Date.parse(expectedVersion);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(
        'This form is out of date. Reload and try again.',
      );
    }

    if (row.updatedAt.toISOString() !== expectedVersion) {
      throw new ConflictException(
        'This application was changed by someone else. Reload and try again.',
      );
    }
  }

  private async recordRejection(
    actor: AuthContext,
    meta: RequestMeta,
    reason: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_CREATE_REJECTED,
      entityType: 'LOAN_APPLICATION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason, ...details },
    });
  }

  private async recordPersistenceFailure(
    actor: AuthContext,
    meta: RequestMeta,
    error: unknown,
    operation: string,
    applicationId: string | null,
  ): Promise<void> {
    this.logger.error(
      `Loan application ${operation} failed for org ${actor.orgId}`,
      error instanceof Error ? error.stack : undefined,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_APPLICATION_PERSISTENCE_FAILED,
        entityType: 'LOAN_APPLICATION',
        entityId: applicationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation },
      })
      .catch(() => {
        // The store is already failing; a second failure must not mask the
        // original error the caller needs to see.
      });
  }

  /**
   * Turns a unique-constraint violation on the application number into a 409.
   *
   * Untranslated, P2002 reaches `AllExceptionsFilter` and renders as a 503
   * reading "Authentication service is temporarily unavailable" — wrong in every
   * particular for a number collision that a retry would resolve.
   */
  private translateUniqueViolation(error: unknown): unknown {
    const prismaCode = (error as { code?: string } | null)?.code;

    if (prismaCode === 'P2002') {
      return new ConflictException(
        'Could not allocate an Application ID. Please try again.',
      );
    }

    return error;
  }
}
