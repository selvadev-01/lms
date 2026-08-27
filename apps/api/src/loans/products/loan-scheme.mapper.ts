import type { LoanSchemeDurationOption, LoanSchemeSummary } from '@lms/types';

/**
 * Row-to-response mappers for schemes.
 *
 * They live here rather than in `loan-scheme.service.ts` because
 * `LoanProductService` needs them too — a product detail embeds its schemes —
 * and importing the service for a pure function would make the two services
 * import each other. A mapper module has no dependencies and breaks the cycle.
 */

export type LoanSchemeRow = {
  orgId: string;
  loanSchemeId: string;
  loanProductId: string;
  code: string;
  name: string;
  interestType: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';
  interestRateBps: bigint;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
};

export type LoanSchemeDurationRow = {
  loanSchemeDurationId: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  durationCount: number;
  status: 'ACTIVE' | 'INACTIVE';
};

export function toSchemeSummary(row: LoanSchemeRow): LoanSchemeSummary {
  return {
    loanSchemeId: row.loanSchemeId,
    loanProductId: row.loanProductId,
    code: row.code,
    name: row.name,
    interestType: row.interestType,
    // Serialized as a decimal string, never a number: JSON.stringify throws on
    // a raw bigint, and Number() would start losing precision on a large value.
    interestRateBps: row.interestRateBps.toString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

export function toDurationOption(
  row: LoanSchemeDurationRow,
): LoanSchemeDurationOption {
  return {
    loanSchemeDurationId: row.loanSchemeDurationId,
    frequency: row.frequency,
    durationCount: row.durationCount,
    status: row.status,
  };
}
