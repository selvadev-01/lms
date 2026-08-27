import {
  addPeriods,
  formatIsoDate,
  parseIsoDate,
  todayInKolkata,
  type CivilDate,
} from "./dates.js";
import { EmiCalculationError } from "./errors.js";
import { flatTotalInterest } from "./flat.js";
import { periodsPerYear } from "./frequency.js";
import { periodInterest, reducingInstallment } from "./reducing.js";
import type { EmiInput, EmiInstallment, EmiSchedule } from "./types.js";

/** Guards against a term long enough to make the fixed-point factor meaningless. */
const MAX_PERIODS = 10_000;

function validate(input: EmiInput): void {
  if (input.principalPaise <= 0n) {
    throw new EmiCalculationError(
      "INVALID_PRINCIPAL",
      "Loan amount must be greater than zero.",
    );
  }
  if (input.annualRateBps < 0n) {
    throw new EmiCalculationError(
      "INVALID_RATE",
      "Interest rate cannot be negative.",
    );
  }
  if (!Number.isInteger(input.durationCount) || input.durationCount < 1) {
    throw new EmiCalculationError(
      "INVALID_DURATION",
      "Duration must be a whole number of periods, at least one.",
    );
  }
  if (input.durationCount > MAX_PERIODS) {
    throw new EmiCalculationError(
      "INVALID_DURATION",
      `Duration cannot exceed ${MAX_PERIODS} periods.`,
    );
  }
  // Throws on an unknown frequency, so every later switch can assume validity.
  periodsPerYear(input.frequency);

  if (
    input.interestType !== "FLAT" &&
    input.interestType !== "REDUCING" &&
    input.interestType !== "CUSTOM_RATE"
  ) {
    throw new EmiCalculationError(
      "INVALID_INTEREST_TYPE",
      `Unsupported interest type: ${String(input.interestType)}`,
    );
  }
}

/**
 * Per-installment principal and interest, before due dates are attached.
 *
 * Both branches return exactly `durationCount` entries whose principals sum to
 * the full principal and whose interests sum to the reported total — the caller
 * relies on that to assemble a schedule that closes at zero.
 */
function splitInstallments(input: EmiInput): {
  principal: bigint[];
  interest: bigint[];
} {
  const { principalPaise, annualRateBps, frequency, durationCount } = input;
  const n = BigInt(durationCount);
  const principal: bigint[] = [];
  const interest: bigint[] = [];

  if (input.interestType === "FLAT") {
    const totalInterest = flatTotalInterest(
      principalPaise,
      annualRateBps,
      frequency,
      durationCount,
    );
    const perPeriodPrincipal = principalPaise / n;
    const perPeriodInterest = totalInterest / n;

    for (let index = 0; index < durationCount; index += 1) {
      principal.push(perPeriodPrincipal);
      interest.push(perPeriodInterest);
    }
    // Residue from both floors lands on the final installment (D-EMI-3).
    const lastIndex = durationCount - 1;
    principal[lastIndex] =
      (principal[lastIndex] ?? 0n) + (principalPaise - perPeriodPrincipal * n);
    interest[lastIndex] =
      (interest[lastIndex] ?? 0n) + (totalInterest - perPeriodInterest * n);
    return { principal, interest };
  }

  // REDUCING and CUSTOM_RATE share this branch — see the note on EmiInterestType.
  // A zero rate makes the amortization formula divide by zero, so it takes the
  // straight-line path instead (D-EMI-7).
  if (annualRateBps === 0n) {
    const perPeriodPrincipal = principalPaise / n;
    for (let index = 0; index < durationCount; index += 1) {
      principal.push(perPeriodPrincipal);
      interest.push(0n);
    }
    const lastIndex = durationCount - 1;
    principal[lastIndex] =
      (principal[lastIndex] ?? 0n) + (principalPaise - perPeriodPrincipal * n);
    return { principal, interest };
  }

  const installment = reducingInstallment(
    principalPaise,
    annualRateBps,
    frequency,
    durationCount,
  );
  let balance = principalPaise;

  for (let index = 0; index < durationCount; index += 1) {
    const isLast = index === durationCount - 1;
    const periodic = periodInterest(balance, annualRateBps, frequency);

    if (isLast) {
      // The final installment repays whatever principal remains, so the schedule
      // closes at exactly zero rather than leaving a stray paisa behind.
      principal.push(balance);
      interest.push(periodic);
      balance = 0n;
      break;
    }

    let principalPart = installment - periodic;
    // A floored installment can, at punitive rates, fail to cover even the
    // period's interest. Clamping at zero keeps the balance monotonic instead of
    // silently growing a negative-amortization schedule nobody asked for.
    if (principalPart < 0n) principalPart = 0n;
    if (principalPart > balance) principalPart = balance;

    principal.push(principalPart);
    interest.push(periodic);
    balance -= principalPart;
  }

  return { principal, interest };
}

/**
 * Builds the full repayment schedule for a proposed loan.
 *
 * Throws `EmiCalculationError` rather than returning a partial result — Module 07
 * requires a calculation failure to block submission outright.
 */
export function computeSchedule(input: EmiInput): EmiSchedule {
  validate(input);

  const start: CivilDate = input.startDate
    ? parseIsoDate(input.startDate)
    : todayInKolkata();
  const { principal, interest } = splitInstallments(input);

  const installments: EmiInstallment[] = [];
  let totalPrincipal = 0n;
  let totalInterest = 0n;
  let balance = input.principalPaise;

  for (let index = 0; index < input.durationCount; index += 1) {
    const principalPart = principal[index] ?? 0n;
    const interestPart = interest[index] ?? 0n;
    balance -= principalPart;
    totalPrincipal += principalPart;
    totalInterest += interestPart;

    installments.push({
      installmentNumber: index + 1,
      // First due date is one full period after the anchor, never the anchor
      // itself — the borrower does not owe an installment on the day they
      // receive the money (D-EMI-5).
      dueDate: formatIsoDate(addPeriods(start, input.frequency, index + 1)),
      principalPaise: principalPart,
      interestPaise: interestPart,
      totalPaise: principalPart + interestPart,
      closingBalancePaise: balance,
    });
  }

  const first = installments[0];
  const last = installments[installments.length - 1];
  if (!first || !last) {
    // Unreachable: validate() rejects durationCount < 1. Kept as a typed guard
    // rather than a non-null assertion so a future change to validate() surfaces
    // here as an error instead of an undefined read.
    throw new EmiCalculationError(
      "INVALID_DURATION",
      "Schedule produced no installments.",
    );
  }

  return {
    installmentAmountPaise: first.totalPaise,
    finalInstallmentPaise: last.totalPaise,
    totalPrincipalPaise: totalPrincipal,
    totalInterestPaise: totalInterest,
    totalPayablePaise: totalPrincipal + totalInterest,
    installmentCount: input.durationCount,
    firstDueDate: first.dueDate,
    lastDueDate: last.dueDate,
    installments,
  };
}
