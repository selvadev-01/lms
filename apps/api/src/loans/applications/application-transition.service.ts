import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ApplicationStatus } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { ApplicationWithRelations } from './loan-application.mapper';

/**
 * The subset of the client a transition's extra work may touch.
 *
 * Deliberately narrow: an `inTransaction` hook exists to write the rows that
 * belong *with* a status change and to re-check the conditions that permitted
 * it, not to become a second place where arbitrary application state is edited.
 *
 * # The Module 09 widening
 *
 * The second block was added for disbursal, and widening this type was a
 * decision rather than a convenience. Everything in it must commit with the
 * application's move to DISBURSED or not at all: the loan row, the disbursement
 * record, the balanced journal entry and the repayment schedule are one
 * financial event, and Rules 14 and 17 are explicit that a loan must not be
 * marked disbursed unless its ledger posting succeeded. Splitting them across
 * transactions would create exactly the ambiguous state Scenario 25 describes.
 *
 * The narrowness still holds where it matters — this is a fixed list of tables
 * a transition may reach, not `PrismaService` itself, so the hook cannot become
 * a general-purpose escape hatch.
 */
export type TransitionTx = Pick<
  PrismaService,
  // Modules 07-08.
  | 'loanApplication'
  | 'loanApplicationReview'
  | 'loanApplicationDocument'
  | 'creditAssessment'
  | 'sanctionLetter'
  | 'auditLog'
  // Read-only, by the completeness check: whether the application's loan type
  // requires a COLLATERAL document is a `LOAN_TYPE` master-data flag now rather
  // than a constant in code.
  | 'masterDataValue'
  // Module 09. One disbursal writes across all of these atomically.
  | 'loan'
  | 'disbursement'
  | 'account'
  | 'accountDimension'
  | 'journalEntry'
  | 'journalLine'
  | 'repaymentSchedule'
  | 'emi'
  // Module 11. One collection posting writes across all of these atomically:
  // the collection row, its allocation lines, the receipt, and the penalties it
  // settles — alongside the `emi` and ledger models Module 09 already listed.
  | 'collection'
  | 'collectionAllocation'
  | 'receipt'
  | 'penalty'
  // Module 12. Receiving an agent's cash writes the handover row, claims the
  // collections whose cash it carries, and posts the custody journal — one
  // financial event, and a partial commit would leave cash claimed with no
  // journal behind it or a journal with nothing claimed. `collection` and the
  // ledger models are already listed above; these are the two new tables.
  //
  // `cashReconciliation` is here because closing a reconciliation also flips
  // the handover it covers to RECONCILED, and the two must move together.
  | 'cashHandover'
  | 'cashReconciliation'
  // Module 12's verification decision writes an audit row alongside the
  // collection's status, which `auditLog` above already covers, plus this.
  | 'collectionVerification'
  | 'user'
>;

export interface TransitionSpec {
  /** Statuses this transition may legally start from. */
  from: ApplicationStatus[];
  to: ApplicationStatus;
  /** An `AuditAction` value. */
  action: string;
  /** Extra columns to set on the application alongside `status`. */
  data?: Record<string, unknown>;
  review?: {
    reviewType:
      | 'BRANCH_REVIEW'
      | 'CREDIT_REVIEW'
      | 'FINAL_APPROVAL'
      | 'MODIFY_TERMS'
      | 'SANCTION';
    decision:
      | 'APPROVED'
      | 'REJECTED'
      | 'MORE_INFO_REQUIRED'
      | 'TERMS_MODIFIED'
      | 'SANCTIONED'
      | 'CUSTOMER_ACCEPTED'
      | 'AGREEMENT_SIGNED';
    comments: string | null;
    rejectionReason?: string;
  };
  metadata?: Record<string, unknown>;
  /**
   * Extra work inside the same transaction, run after the guard has matched and
   * before the audit record.
   *
   * This is the seam sanction issuance needs: the letter row and the status
   * change must commit together or not at all (Rule 48). A second transaction
   * would let a SANCTIONED application exist with no letter — a state nothing
   * downstream could interpret.
   *
   * It runs *after* the guard deliberately. Running it first would do the work
   * on behalf of a transition that then turns out to be illegal or stale, and
   * the rollback would hide it. A throw here rolls the status change back.
   */
  inTransaction?: (tx: TransitionTx, actor: AuthContext) => Promise<void>;
}

/**
 * The one lifecycle-transition primitive every application status change goes
 * through, across Modules 07 and 08.
 *
 * # The guard
 *
 * Every transition has the same shape:
 *
 * ```
 * updateMany({ where: { ...ids, status: expected, updatedAt: expected }, data })
 * if (result.count === 0) -> 409
 * ```
 *
 * The `status` and `updatedAt` in the WHERE are not redundant with a prior read.
 * The house `assertVersion` idiom — read the row, compare its timestamp, then
 * write — is check-then-act, and two concurrent requests can both pass it before
 * either writes. That is exactly Scenario 52: an approve and a reject arriving
 * together would both commit, and the application's final state would be
 * whichever transaction happened to land second.
 *
 * Putting both values in the WHERE makes the database arbitrate. `updateMany`
 * returns a count instead of throwing on zero rows, so the `count === 0` check
 * *is* the mechanism — omitting it would silently reinstate the race.
 *
 * The guard does double duty: `status` enforces that the transition is legal
 * from the current state, so an approve racing a reject fails on the status even
 * if the timestamps somehow matched.
 *
 * # Why this is its own service
 *
 * It began as a private method on `LoanApplicationReviewService`, centralised so
 * the guard could not be written correctly in four places and wrongly in a
 * fifth. Module 08 made it eight places across two services, so it moved here
 * rather than being reached through a service that sanction has no other reason
 * to depend on.
 */
@Injectable()
export class ApplicationTransitionService {
  private readonly logger = new Logger(ApplicationTransitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    before: ApplicationWithRelations,
    expectedVersion: string,
    meta: RequestMeta,
    spec: TransitionSpec,
  ): Promise<void> {
    const expected = this.assertParsableVersion(expectedVersion);

    /**
     * The caller's belief about the row, checked against what was actually read.
     *
     * Without this the guard below would compare `before.updatedAt` — a value
     * the caller just read for itself — against the row, which always matches.
     * The client's `expectedVersion` would then be decorative: a reviewer acting
     * on a screen loaded before someone else's edit would commit anyway. The
     * guard still earns its place, because it closes the window *between* that
     * read and the write; this closes the window before the read.
     */
    if (before.updatedAt.getTime() !== expected.getTime()) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_APPLICATION_CONCURRENT_EDIT_REJECTED,
        entityType: 'LOAN_APPLICATION',
        entityId: before.applicationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          attempted: spec.to,
          expectedVersion,
          actualVersion: before.updatedAt.toISOString(),
          stage: 'PRE_READ',
        },
      });

      throw new ConflictException(
        'This application was changed by someone else. Reload and try again.',
      );
    }

    if (!spec.from.includes(before.status)) {
      await this.recordTransitionRejected(
        actor,
        before,
        meta,
        `ILLEGAL_FROM_${before.status}`,
      );

      // REJECTED and AGREEMENT_SIGNED are in no `from` list, so a further
      // decision on either lands in this branch. APPROVED is deliberately *not*
      // named here: since Module 08 it moves on to SANCTIONED, and calling it
      // terminal would be a message that contradicts the state machine.
      throw new ConflictException(
        before.status === 'REJECTED'
          ? 'This application has already been rejected and cannot be changed'
          : before.status === 'AGREEMENT_SIGNED'
            ? 'This application has a signed agreement and is awaiting disbursal'
            : `An application that is ${before.status} cannot move to ${spec.to}`,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const guard = await tx.loanApplication.updateMany({
          where: {
            orgId: actor.orgId,
            applicationId: before.applicationId,
            // Both halves of the guard. See the class comment: without these two
            // keys the concurrent approve/reject of Scenario 52 both commit.
            status: before.status,
            updatedAt: before.updatedAt,
          },
          data: {
            status: spec.to,
            updatedBy: actor.userId,
            ...(spec.data ?? {}),
          },
        });

        if (guard.count === 0) {
          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.LOAN_APPLICATION_CONCURRENT_EDIT_REJECTED,
              entityType: 'LOAN_APPLICATION',
              entityId: before.applicationId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                attempted: spec.to,
                expectedStatus: before.status,
                expectedVersion,
              },
            },
            tx,
          );

          throw new ConflictException(
            'This application was changed by someone else. Reload and try again.',
          );
        }

        if (spec.inTransaction) {
          await spec.inTransaction(tx, actor);
        }

        if (spec.review) {
          await tx.loanApplicationReview.create({
            data: {
              orgId: actor.orgId,
              applicationId: before.applicationId,
              reviewerId: actor.userId,
              reviewType: spec.review.reviewType,
              decision: spec.review.decision,
              comments: spec.review.comments,
              rejectionReason: spec.review.rejectionReason ?? null,
            },
          });
        }

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: spec.action,
            entityType: 'LOAN_APPLICATION',
            entityId: before.applicationId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { status: before.status },
            newData: { status: spec.to },
            ...(spec.metadata ? { metadata: spec.metadata } : {}),
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;

      this.logger.error(
        `Loan application transition to ${spec.to} failed for org ${actor.orgId}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.LOAN_APPLICATION_PERSISTENCE_FAILED,
          entityType: 'LOAN_APPLICATION',
          entityId: before.applicationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { operation: `transition:${spec.to}` },
        })
        .catch(() => {});

      throw error;
    }
  }

  /**
   * A malformed version is a 400 before any query runs.
   *
   * The guard compares `updatedAt` as a `Date`, so an unparseable string would
   * otherwise become an `Invalid Date` that matches nothing — a 409 claiming
   * someone else changed the record, when the real fault is the request.
   */
  assertParsableVersion(expectedVersion: string): Date {
    const parsed = Date.parse(expectedVersion);

    if (Number.isNaN(parsed)) {
      throw new BadRequestException(
        'This form is out of date. Reload and try again.',
      );
    }

    return new Date(parsed);
  }

  async recordTransitionRejected(
    actor: AuthContext,
    before: ApplicationWithRelations,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_APPLICATION_TRANSITION_REJECTED,
      entityType: 'LOAN_APPLICATION',
      entityId: before.applicationId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason, status: before.status },
    });
  }
}
