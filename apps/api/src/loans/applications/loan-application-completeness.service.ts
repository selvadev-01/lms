import { computeSchedule, EmiCalculationError } from '@lms/emi';
import { Injectable } from '@nestjs/common';
import type {
  ApplicationCompleteness,
  CompletenessCheck,
  CompletenessCheckKey,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { GuarantorService } from '../../customers/guarantor/guarantor.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  toEmiView,
  toIsoDate,
  type ApplicationWithRelations,
} from './loan-application.mapper';

/**
 * The documents an application must carry before it can be submitted (D-APP-3).
 *
 * ID and INCOME always; COLLATERAL additionally for the two secured products.
 * The source names the three categories (Rule 34) but never says which are
 * required for which product (Q-APP-61/62/63), so this is a documented default
 * rather than a source requirement — a gold loan with no collateral document is
 * the case it exists to stop.
 */
const BASE_REQUIRED_DOCUMENTS = ['ID', 'INCOME'] as const;
const COLLATERAL_LOAN_TYPES = new Set(['GOLD', 'VEHICLE']);

export function requiredDocumentTypes(loanType: string): string[] {
  return COLLATERAL_LOAN_TYPES.has(loanType)
    ? [...BASE_REQUIRED_DOCUMENTS, 'COLLATERAL']
    : [...BASE_REQUIRED_DOCUMENTS];
}

/** The nine checks, in fixed display order. */
const CHECK_ORDER: readonly CompletenessCheckKey[] = [
  'CUSTOMER_ACTIVE',
  'SCHEME_ACTIVE',
  'DURATION_SUPPORTED',
  'AMOUNT_VALID',
  'PURPOSE_PRESENT',
  'RATE_VALID',
  'GUARANTORS_READY',
  'DOCUMENTS_COMPLETE',
  'EMI_COMPUTES',
];

/**
 * Module 07 — application completeness.
 *
 * Answers "could this application be submitted right now", and is used two ways:
 * by the wizard's step 6 as an advisory summary, and by the submit path itself
 * as the authoritative gate. Both call the same evaluation, which is the point —
 * a validation summary that could disagree with what submit actually enforces
 * would be worse than none.
 *
 * The evaluation takes a `tx` so submit can run it *inside* its own transaction.
 * That is what makes Rule 72 hold: a scheme deactivated between the wizard's
 * preview and the submit is still caught, because the check and the write are
 * one atomic step rather than two.
 *
 * Every check is always returned, satisfied or not, so step 6 can render a
 * stable list with green ticks rather than a list that changes shape as problems
 * are fixed.
 */
@Injectable()
export class LoanApplicationCompletenessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guarantors: GuarantorService,
  ) {}

  /**
   * Evaluates all nine checks.
   *
   * `guarantorReadiness` is passed in rather than read here because
   * `GuarantorService.evaluateReadiness` needs an `AuthContext` and does its own
   * scope resolution — calling it inside a transaction would nest a second scope
   * check in a place that cannot use one. The caller resolves it first.
   */
  async evaluate(
    tx: Pick<
      PrismaService,
      | 'loanScheme'
      | 'loanSchemeDuration'
      | 'loanApplicationDocument'
      | 'customer'
    >,
    application: ApplicationWithRelations,
    guarantorsReady: { satisfied: boolean; blockers: unknown[] },
  ): Promise<ApplicationCompleteness> {
    const results = new Map<CompletenessCheckKey, CompletenessCheck>();
    const fail = (
      key: CompletenessCheckKey,
      reason: string,
      details?: Record<string, unknown>,
    ) =>
      results.set(key, {
        key,
        satisfied: false,
        reason,
        ...(details ? { details } : {}),
      });
    const pass = (key: CompletenessCheckKey) =>
      results.set(key, { key, satisfied: true });

    // 1. Customer still active (Rules 22-26).
    const customer = await tx.customer.findUnique({
      where: {
        orgId_customerId: {
          orgId: application.orgId,
          customerId: application.customerId,
        },
      },
    });

    if (customer?.status === 'ACTIVE') {
      pass('CUSTOMER_ACTIVE');
    } else {
      fail('CUSTOMER_ACTIVE', 'CUSTOMER_NOT_ACTIVE', {
        status: customer?.status ?? 'MISSING',
      });
    }

    // 2 & 3. Scheme selectable, and the chosen term offered (Rules 7, 8, 71).
    const scheme = await tx.loanScheme.findUnique({
      where: {
        orgId_loanSchemeId: {
          orgId: application.orgId,
          loanSchemeId: application.loanSchemeId,
        },
      },
      include: { loanProduct: true, durations: true },
    });

    const typedScheme = scheme as unknown as {
      status: string;
      interestType: string;
      interestRateBps: bigint;
      loanProduct: { status: string };
      durations: {
        status: string;
        frequency: string;
        durationCount: number;
      }[];
    } | null;

    if (!typedScheme) {
      fail('SCHEME_ACTIVE', 'SCHEME_NOT_FOUND');
      fail('DURATION_SUPPORTED', 'SCHEME_NOT_FOUND');
    } else if (typedScheme.loanProduct.status !== 'ACTIVE') {
      fail('SCHEME_ACTIVE', 'PRODUCT_INACTIVE');
      fail('DURATION_SUPPORTED', 'PRODUCT_INACTIVE');
    } else if (typedScheme.status !== 'ACTIVE') {
      fail('SCHEME_ACTIVE', 'SCHEME_INACTIVE');
      fail('DURATION_SUPPORTED', 'SCHEME_INACTIVE');
    } else {
      pass('SCHEME_ACTIVE');

      const supported = typedScheme.durations.some(
        (duration) =>
          duration.status === 'ACTIVE' &&
          duration.frequency === application.repaymentFrequency &&
          duration.durationCount === application.durationCount,
      );

      if (supported) {
        pass('DURATION_SUPPORTED');
      } else {
        fail('DURATION_SUPPORTED', 'TERM_NOT_OFFERED', {
          frequency: application.repaymentFrequency,
          durationCount: application.durationCount,
        });
      }
    }

    // 4. Amount (Rules 9, 10).
    if (application.requestedAmountPaise > 0n) {
      pass('AMOUNT_VALID');
    } else {
      fail('AMOUNT_VALID', 'AMOUNT_NOT_POSITIVE');
    }

    // 5. Purpose (Rule 11). The column is nullable but the rule is not, so this
    // is enforced here rather than by the database.
    if ((application.purpose ?? '').trim().length > 0) {
      pass('PURPOSE_PRESENT');
    } else {
      fail('PURPOSE_PRESENT', 'PURPOSE_MISSING');
    }

    // 6. Rate. A rate differing from the scheme's is only legitimate under
    // CUSTOM_RATE, which is what makes an off-scheme price a deliberate act
    // rather than a typo that priced a loan wrong.
    if (application.interestRateBps < 0n) {
      fail('RATE_VALID', 'RATE_NEGATIVE');
    } else if (
      typedScheme &&
      application.interestRateBps !== typedScheme.interestRateBps &&
      application.interestType !== 'CUSTOM_RATE'
    ) {
      fail('RATE_VALID', 'RATE_DIFFERS_FROM_SCHEME', {
        applicationRateBps: application.interestRateBps.toString(),
        schemeRateBps: typedScheme.interestRateBps.toString(),
      });
    } else {
      pass('RATE_VALID');
    }

    // 7. Guarantors (D-APP-2). `GuarantorService` answers "are the guarantors
    // that exist usable"; whether one was needed at all is this module's call,
    // and the default is not-required because the source never says otherwise
    // (Q-APP-95). So an absent guarantor never blocks — only an unusable one.
    if (guarantorsReady.satisfied) {
      pass('GUARANTORS_READY');
    } else {
      fail('GUARANTORS_READY', 'GUARANTOR_NOT_READY', {
        blockers: guarantorsReady.blockers,
      });
    }

    // 8. Documents (Rule 34, Scenario 18).
    const missingDocumentTypes = await this.missingDocuments(tx, application);

    if (missingDocumentTypes.length === 0) {
      pass('DOCUMENTS_COMPLETE');
    } else {
      fail('DOCUMENTS_COMPLETE', 'DOCUMENTS_MISSING', {
        missing: missingDocumentTypes,
      });
    }

    // 9. EMI (Rules 16, 82; Scenarios 12, 50).
    let emiError: string | null = null;
    try {
      computeSchedule({
        principalPaise: application.requestedAmountPaise,
        annualRateBps: application.interestRateBps,
        interestType: application.interestType,
        frequency: application.repaymentFrequency,
        durationCount: application.durationCount,
        startDate: toIsoDate(new Date()),
      });
      pass('EMI_COMPUTES');
    } catch (error) {
      emiError = error instanceof EmiCalculationError ? error.code : 'UNKNOWN';
      fail('EMI_COMPUTES', emiError);
    }

    const checks = CHECK_ORDER.map(
      (key) =>
        results.get(key) ?? { key, satisfied: false, reason: 'NOT_EVALUATED' },
    );

    return {
      applicationId: application.applicationId,
      submittable: checks.every((check) => check.satisfied),
      checks,
      missingDocumentTypes,
      emi: emiError ? null : toEmiView(application),
      version: application.updatedAt.toISOString(),
    };
  }

  /**
   * The required document types with no current upload.
   *
   * "Current" means not superseded — a replaced document no longer evidences
   * anything. Presence is enough here; verification is deliberately *not*
   * required to submit, because a branch cannot review its own submission before
   * making it. Whether approval should require verification rather than mere
   * upload is Q-APP-157, and is left to the approver's judgement.
   */
  async missingDocuments(
    tx: Pick<PrismaService, 'loanApplicationDocument'>,
    application: ApplicationWithRelations,
  ): Promise<string[]> {
    const required = requiredDocumentTypes(application.loanProduct.loanType);

    const rows = await tx.loanApplicationDocument.findMany({
      where: {
        orgId: application.orgId,
        applicationId: application.applicationId,
        supersededAt: null,
        // A rejected document does not satisfy a requirement: it was reviewed
        // and found wanting, so the requirement is still outstanding.
        status: { not: 'REJECTED' },
      },
      select: { documentType: true },
    });

    const present = new Set(rows.map((row) => row.documentType));

    return required.filter((type) => !present.has(type));
  }

  /** Resolves guarantor readiness for the customer behind an application. */
  async guarantorReadiness(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<{ satisfied: boolean; blockers: unknown[] }> {
    const readiness = await this.guarantors.evaluateReadiness(
      actor,
      customerId,
      meta,
    );

    return { satisfied: readiness.satisfied, blockers: readiness.blockers };
  }
}
