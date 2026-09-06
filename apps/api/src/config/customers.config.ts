import { registerAs } from '@nestjs/config';

/**
 * Customer & KYC configuration (Module 04).
 *
 * The story defines the KYC workflow but not its operational limits: file size
 * and type validation (Q-CUST-16), retention (Q-CUST-18) and the mobile
 * verification parameters are all unanswered. Every value below is an *applied
 * default* — env-driven, so answering the open question changes an environment
 * variable rather than this file.
 *
 * Two things are deliberately not tunable:
 *
 * - **The required KYC document set.** `ID`, `ADDRESS` and `PHOTO` are named by
 *   the source, so they live in `kyc.service.ts` as a fixed rule. A deployment
 *   that could switch off the address requirement would be able to approve a
 *   customer the story says is incomplete.
 *
 * - **The direction of failure.** No setting here can make an unverified LOCAL
 *   customer active or an unapproved KYC customer active (Rules 6, 12).
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default registerAs('customers', () => ({
  // --- KYC document storage (Q-CUST-16) -----------------------------------
  /**
   * Where uploaded KYC files are written.
   *
   * Must be outside the web root and outside the repository. Nothing serves
   * this directory statically: the only way to read a file is through
   * `GET /customers/:customerId/documents/:documentId/file`, which re-checks
   * organization and branch scope and audits the access (Scenarios 12, 32).
   *
   * The default sits under the API package so a fresh clone works, but any real
   * deployment should point this at a volume with its own backup and retention
   * policy — see Q-CUST-18, which is still open.
   */
  kycStorageDir: process.env.KYC_STORAGE_DIR ?? './storage/kyc',

  /**
   * Largest accepted upload, in bytes (Q-CUST-16).
   *
   * 5 MB comfortably holds a phone photograph of an ID card or a scanned PDF,
   * and is small enough that a malicious upload cannot exhaust the disk in one
   * request. The multipart limit and this value are the same number on purpose:
   * one of them alone would let a request either be truncated or be accepted at
   * a size the service then rejects.
   */
  maxDocumentBytes: int(process.env.KYC_MAX_DOCUMENT_BYTES, 5 * 1024 * 1024),

  // --- LOCAL mobile verification (Scenarios 2, 14) ------------------------
  /**
   * OTP length. Matches the password-recovery default so a customer and a staff
   * member are not asked for codes of different shapes by the same system.
   */
  otpLength: int(process.env.CUSTOMER_OTP_LENGTH, 6),

  /**
   * How long a minted OTP stays usable, in minutes.
   *
   * Longer than a password-reset code (10 minutes there) because the person
   * reading it is a walk-in customer at a branch counter rather than the account
   * holder at their own device, and re-sending means re-queuing an SMS.
   */
  otpTtlMinutes: int(process.env.CUSTOMER_OTP_TTL_MINUTES, 15),

  /**
   * Wrong guesses allowed before the code is burned and a new one is required.
   *
   * Bounded because a 6-digit code is only 10^6 wide; unbounded attempts would
   * make it guessable in an afternoon.
   */
  otpMaxAttempts: int(process.env.CUSTOMER_OTP_MAX_ATTEMPTS, 5),

  /**
   * A fixed code that always verifies, for development only.
   *
   * Unset by default, and the service refuses to start when it is set with
   * `NODE_ENV=production` — the same guard `ConsoleSmsProvider` applies to
   * itself, for the same reason: a deployment that accepts a constant OTP has
   * no mobile verification at all, and that must fail loudly at boot rather
   * than quietly at every customer.
   *
   * A real code is still minted, sent and stored on every request, so the
   * ordinary path is exercised even while this is set; this only adds a second
   * accepted answer. Nothing else about the flow changes, which is what keeps
   * the development shortcut from becoming a different code path to the one
   * production runs.
   */
  otpDevCode: process.env.CUSTOMER_OTP_DEV_CODE ?? null,
}));
