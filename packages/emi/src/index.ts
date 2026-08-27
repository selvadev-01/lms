/**
 * `@lms/emi` — integer-paise EMI schedule calculation.
 *
 * Lives in its own package, rather than inside the API, so that one
 * implementation of the money formula serves every caller. Two copies is exactly
 * the kind of thing that drifts quietly until a borrower is billed the wrong
 * amount, so there is only ever this one.
 *
 * **The browser does not call it, deliberately.** The package is importable from
 * the web app and the application wizard still asks the server instead, through
 * `/api/loan-applications/emi-preview`. The server's figure is what submit and
 * approve are checked against, and a locally-derived number that disagreed by a
 * paisa would be worse than a brief spinner. Today's only consumer is the API.
 *
 * Zero runtime dependencies and no I/O: every function here is pure, which is
 * what lets the API recompute authoritatively at submit and again at approve
 * without trusting anything a client sent.
 */
export { computeSchedule } from "./schedule.js";
export { EmiCalculationError, type EmiErrorCode } from "./errors.js";
/**
 * Payment appropriation (Module 11).
 *
 * The other half of the money story: `computeSchedule` decides what is owed,
 * `allocate` decides what a payment settles. Pure and deterministic for the
 * same reason — the API recomputes the split authoritatively at posting time
 * and must be able to replay it from stored balances afterwards.
 */
export {
  allocate,
  AllocationError,
  APPROPRIATION_ORDER,
  type AllocationComponent,
  type AllocationErrorCode,
  type AllocationLine,
  type AllocationResult,
  type AllocationTarget,
} from "./allocation.js";
/**
 * Delinquency arithmetic (Module 13).
 *
 * The third part of the money story: `computeSchedule` decides what is owed,
 * `allocate` decides what a payment settles, and these decide how late it is.
 * Pure and deterministic for the same reason — Scenario 8 requires the same
 * schedule, payments and business date to always produce the same overdue
 * result, replayable from authoritative data long afterwards.
 *
 * Nothing here is ever stored: days past due, the bucket and the classification
 * are derived on every read, exactly as `deriveEmiStatus` derives an
 * installment's status one level down.
 */
export {
  classifyNpa,
  daysBetween,
  daysPastDue,
  delinquencyBucket,
  NPA_THRESHOLD_DAYS,
  summarizeOverdue,
  type DelinquencyBucket,
  type NpaStatus,
  type OverdueObligation,
  type OverduePosition,
} from "./overdue.js";
/**
 * Penal interest assessment (Module 13).
 *
 * Module 11 allocates against `Penalty` rows and never computes one; this is
 * where the figure comes from. Deterministic rather than scheduled (Rule 13):
 * a nightly sweep would make the charge depend on whether the job ran, while a
 * pure function of (rule, balance, dates) can be replayed years later.
 */
export {
  assessPenalty,
  PenaltyConfigurationError,
  type PenaltyAssessment,
  type PenaltyBasis,
  type PenaltyCalculationSnapshot,
  type PenaltyCalculationType,
  type PenaltyErrorCode,
  type PenaltyRuleInput,
} from "./penalty.js";
export { periodicRate, periodsPerYear } from "./frequency.js";
/**
 * Civil-date helpers, exported for callers that must decide what "today" is.
 *
 * `todayInKolkata` is the authoritative business date: Module 10 derives an
 * EMI's due status by comparing its due date against it, so that a client with
 * a wrong clock cannot move an installment into or out of overdue (Module 10
 * Scenario 39). Comparing `CivilDate`s rather than `Date`s is the point — the
 * same reason the rest of this package never touches a timezone offset.
 */
export {
  addPeriods,
  formatIsoDate,
  parseIsoDate,
  todayInKolkata,
} from "./dates.js";
export type { CivilDate } from "./dates.js";
export type {
  EmiFrequency,
  EmiInput,
  EmiInstallment,
  EmiInterestType,
  EmiSchedule,
} from "./types.js";
