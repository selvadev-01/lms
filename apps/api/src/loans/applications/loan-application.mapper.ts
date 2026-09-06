import { computeSchedule, EmiCalculationError } from '@lms/emi';
import type {
  ApplicationStatus,
  EmiScheduleView,
  InterestType,
  LoanApplicationDocumentSummary,
  LoanApplicationHistoryEntry,
  LoanApplicationSummary,
  RepaymentFrequency,
} from '@lms/types';

/**
 * Row-to-response mappers for applications.
 *
 * Separate from the service for the same reason as `loan-scheme.mapper.ts`: the
 * application, review and document services all need them, and importing one
 * service into another for a pure function is how a cycle starts.
 */

export type LoanApplicationRow = {
  orgId: string;
  applicationId: string;
  applicationNumber: string;
  branchId: string;
  customerId: string;
  loanProductId: string;
  loanSchemeId: string;
  requestedAmountPaise: bigint;
  purpose: string | null;
  interestType: InterestType;
  interestRateBps: bigint;
  repaymentFrequency: RepaymentFrequency;
  durationCount: number;
  status: ApplicationStatus;
  rejectionReason: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  /** Module 08 lifecycle stamps. Null until that step has happened. */
  sanctionedAt: Date | null;
  customerRespondedAt: Date | null;
  agreementSignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ApplicationWithRelations = LoanApplicationRow & {
  customer: { fullName: string; customerCode: string };
  branch: { name: string };
  loanProduct: {
    code: string;
    loanType: string;
  };
  loanScheme: { code: string; name: string };
};

export function toApplicationSummary(
  row: ApplicationWithRelations,
): LoanApplicationSummary {
  return {
    applicationId: row.applicationId,
    applicationNumber: row.applicationNumber,
    customerId: row.customerId,
    customerName: row.customer.fullName,
    customerCode: row.customer.customerCode,
    branchId: row.branchId,
    // Decimal strings, never numbers: JSON has no bigint, and Number() would
    // start losing paise on a large loan.
    requestedAmountPaise: row.requestedAmountPaise.toString(),
    purpose: row.purpose ?? undefined,
    loanType: row.loanProduct.loanType,
    schemeName: row.loanScheme.name,
    interestType: row.interestType,
    interestRateBps: row.interestRateBps.toString(),
    repaymentFrequency: row.repaymentFrequency,
    durationCount: row.durationCount,
    status: row.status,
    rejectionReason: row.rejectionReason ?? undefined,
    submittedAt: row.submittedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // The optimistic-concurrency token. Lifecycle transitions additionally put
    // this in the `updateMany` WHERE clause, because a read-then-write check
    // cannot stop a concurrent approve/reject (Scenario 52).
    version: row.updatedAt.toISOString(),
  };
}

/**
 * The application's repayment schedule, recomputed from its stored terms.
 *
 * Deliberately computed on every read rather than persisted, so it can never
 * disagree with the terms it claims to describe — a stored schedule and a later
 * Modify Terms would drift the moment one was written without the other.
 *
 * Returns `null` rather than throwing when the terms no longer compute. A read
 * of a broken application should still show why it is broken; it is *submit* and
 * *approve* that must refuse (Scenarios 12, 50), and they call the calculator
 * directly rather than going through here.
 */
export function toEmiView(row: LoanApplicationRow): EmiScheduleView | null {
  try {
    const schedule = computeSchedule({
      principalPaise: row.requestedAmountPaise,
      annualRateBps: row.interestRateBps,
      interestType: row.interestType,
      frequency: row.repaymentFrequency,
      durationCount: row.durationCount,
      // Anchored to submission where there is one, so a submitted application's
      // preview does not slide forward a day at a time as it sits in review.
      startDate: toIsoDate(row.submittedAt ?? row.createdAt),
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
    if (error instanceof EmiCalculationError) return null;
    throw error;
  }
}

/**
 * A `Date` as a DATE-only string in Asia/Kolkata.
 *
 * Formatted through `Intl` in that zone rather than by slicing the ISO string:
 * `toISOString()` is UTC, so between 18:30 and 24:00 IST it names the previous
 * day. A schedule anchored a day early is a schedule of wrong due dates.
 */
export function toIsoDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export type ApplicationDocumentRow = {
  orgId: string;
  applicationDocumentId: string;
  applicationId: string;
  documentType: string;
  fileRef: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  documentNumber: string | null;
  version: number;
  supersededAt: Date | null;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verificationReason: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  uploadedBy: string;
  createdAt: Date;
};

export function toDocumentSummary(
  row: ApplicationDocumentRow,
): LoanApplicationDocumentSummary {
  return {
    applicationDocumentId: row.applicationDocumentId,
    applicationId: row.applicationId,
    documentType: row.documentType,
    fileName: row.fileName ?? undefined,
    mimeType: row.mimeType ?? undefined,
    fileSize: row.fileSize ?? undefined,
    documentNumber: row.documentNumber ?? undefined,
    version: row.version,
    supersededAt: row.supersededAt?.toISOString(),
    status: row.status,
    verificationReason: row.verificationReason ?? undefined,
    verifiedAt: row.verifiedAt?.toISOString(),
    verifiedBy: row.verifiedBy ?? undefined,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ReviewRow = {
  reviewId: string;
  reviewType:
    'BRANCH_REVIEW' | 'CREDIT_REVIEW' | 'FINAL_APPROVAL' | 'MODIFY_TERMS';
  decision: 'APPROVED' | 'REJECTED' | 'MORE_INFO_REQUIRED' | 'TERMS_MODIFIED';
  reviewerId: string;
  comments: string | null;
  rejectionReason: string | null;
  previousInterestType: InterestType | null;
  previousInterestRateBps: bigint | null;
  previousFrequency: RepaymentFrequency | null;
  previousDurationCount: number | null;
  createdAt: Date;
};

export function toHistoryEntry(
  row: ReviewRow,
  reviewerName: string,
): LoanApplicationHistoryEntry {
  return {
    reviewId: row.reviewId,
    reviewType: row.reviewType,
    decision: row.decision,
    reviewerId: row.reviewerId,
    reviewerName,
    comments: row.comments ?? undefined,
    rejectionReason: row.rejectionReason ?? undefined,
    previousInterestType: row.previousInterestType ?? undefined,
    previousInterestRateBps: row.previousInterestRateBps?.toString(),
    previousFrequency: row.previousFrequency ?? undefined,
    previousDurationCount: row.previousDurationCount ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
