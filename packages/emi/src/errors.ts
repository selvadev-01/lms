/**
 * Thrown when a schedule cannot be produced.
 *
 * Deliberately an exception rather than a partial or empty schedule: Module 07
 * Scenarios 12 and 50 require submission to be *blocked* on a calculation
 * failure, and a caller handed a half-built schedule could mistake it for
 * success. There is no partially-valid EMI result.
 */
export class EmiCalculationError extends Error {
  /** Machine-readable, so an API layer can map it without matching on prose. */
  readonly code: EmiErrorCode;

  constructor(code: EmiErrorCode, message: string) {
    super(message);
    this.name = "EmiCalculationError";
    this.code = code;
    // Restores the prototype chain under the CJS build's ES5-ish class
    // downlevelling, so `instanceof EmiCalculationError` holds for API callers.
    Object.setPrototypeOf(this, EmiCalculationError.prototype);
  }
}

export type EmiErrorCode =
  | "INVALID_PRINCIPAL"
  | "INVALID_RATE"
  | "INVALID_DURATION"
  | "INVALID_FREQUENCY"
  | "INVALID_INTEREST_TYPE"
  | "INVALID_START_DATE";
