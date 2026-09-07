import type { LoanSummaryView, ScheduleLoanSummary } from '@lms/types';

import { toIsoDate } from '../applications/loan-application.mapper';
import type { LoanWithRelations } from './loan.service';

export type { LoanSummaryView };

/**
 * A loan as a list row.
 *
 * `LoanSummaryView` extends `ScheduleLoanSummary` in `@lms/types` rather than
 * being a parallel shape: the repayment schedule already publishes these fields
 * for this row, and a second near-identical loan type is how two screens start
 * disagreeing about what a loan is called.
 */
export function toLoanSummary(loan: LoanWithRelations): LoanSummaryView {
  return {
    loanId: loan.loanId,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.customer.fullName,
    branchId: loan.branchId,
    branchName: loan.branch.name,
    status: loan.status as ScheduleLoanSummary['status'],
    // Serialized as decimal strings, never numbers: JSON.stringify throws on a
    // raw bigint, and Number() would start losing precision on a large amount.
    principalAmountPaise: loan.principalAmountPaise.toString(),
    interestRateBps: loan.interestRateBps.toString(),
    interestType: loan.interestType,
    repaymentFrequency: loan.repaymentFrequency,
    durationCount: loan.durationCount,
    schemeCode: loan.loanScheme.code,
    schemeName: loan.loanScheme.name,
    ...(loan.disbursementDate
      ? { disbursementDate: toIsoDate(loan.disbursementDate) }
      : {}),
  };
}
