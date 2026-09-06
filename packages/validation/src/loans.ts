import { z } from "zod";

import { optionsFrom } from "./options";
import { optionalText } from "./primitives";

/**
 * Modules 06-07 schemas — loan products, schemes, and loan applications.
 *
 * Follows `customers.ts` in both structure and constraints. The import above
 * reaches for `./primitives` rather than `./index` for the same reason given
 * there: `index.ts` re-exports this file from its last line, so importing from
 * it here would be a live runtime cycle, not merely a type-level one.
 *
 * Four conventions run through every schema:
 *
 * 1. **No scope fields.** No `orgId` and no `branchId`. Both come from the JWT
 *    and from the selected customer's own branch, which is what makes Scenarios
 *    41-43 structural rather than a check somebody has to remember. The API's
 *    `forbidNonWhitelisted` turns an attempt to send either into a 400.
 *
 * 2. **One field, one endpoint.** Status changes, lifecycle transitions and term
 *    modifications each have their own route, their own permission and their own
 *    schema. Being allowed to fix a typo in a draft is not thereby permission to
 *    approve it.
 *
 * 3. **Money is integer paise, rates are integer basis points.** Both arrive as
 *    strings and are validated as digit strings rather than parsed to `number`:
 *    a rupee amount large enough to matter exceeds `Number.MAX_SAFE_INTEGER` in
 *    paise, and `z.coerce.number()` would round it silently rather than fail.
 *    Services parse with `BigInt`.
 *
 * 4. **Decorator/refinement order is deliberate.** Where a field is both required
 *    and bounded, the required check runs first so a blank submission reports
 *    "X is required" rather than a length complaint about an empty string.
 */

/**
 * A `LOAN_TYPE` master-data code.
 *
 * This was `z.enum(["PERSONAL","BUSINESS","GOLD","VEHICLE"])` — the four types
 * the codebase happened to know about. It is now an open code string, because
 * the list is admin-managed per tenant and a compiled-in enum cannot name a type
 * a tenant invents. The set of *valid* codes is whatever that tenant's
 * `LOAN_TYPE` rows say, which only the API can check, so it does so on write.
 *
 * The shape is still constrained to the master-data code character class, so a
 * malformed value is refused here rather than reaching a lookup that would
 * merely fail to match. `.min(1)` leads so an untouched select reports "Loan
 * Type is required" instead of a regex complaint — `required_error` alone does
 * not fire for `""`, which is what an unselected `<select>` submits.
 */
export const loanTypeSchema = z
  .string({ required_error: "Loan Type is required" })
  .trim()
  .min(1, "Loan Type is required")
  .max(50, "Loan Type must be 50 characters or fewer")
  .regex(/^[A-Z][A-Z0-9_]*$/, "Loan Type is required");

export const interestTypeSchema = z.enum(["FLAT", "REDUCING", "CUSTOM_RATE"], {
  errorMap: () => ({ message: "Interest Type is required" }),
});

export const repaymentFrequencySchema = z.enum(
  ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"],
  { errorMap: () => ({ message: "Frequency is required" }) },
);

/**
 * Product and scheme lifecycle. DRAFT exists so a scheme can be assembled — it
 * needs at least one duration option before it means anything — without being
 * selectable by an application in the meantime.
 */
export const loanConfigStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE"]);

/**
 * Where a loan application sits in its review (Module 07).
 *
 * Named rather than left inline in `listLoanApplicationsSchema` so the filter
 * dropdown, the status badge and the validator all read one definition. They
 * previously did not: the list derived its labels mechanically with
 * `.replace(/_/g," ").toLowerCase()` and rendered "more info required", while
 * the badge beside it used a hand-written map saying "More info needed".
 */
export const applicationStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
  // Module 08. `CUSTOMER_REJECTED` is deliberately absent even though the
  // Prisma enum carries it: a customer's decline of the sanction letter lands
  // on the unified REJECTED with its reason recorded (Rule 13).
  "SANCTIONED",
  "CUSTOMER_ACCEPTED",
  "AGREEMENT_SIGNED",
  // Module 09. AGREEMENT_SIGNED was terminal here as a module boundary, not as
  // a business rule, and disbursal is what moves past it. DISBURSEMENT_PENDING
  // means a disbursement is scheduled and the loan row exists; DISBURSED means
  // the money moved and the ledger balanced. `CLOSED` remains Module 15's.
  "DISBURSEMENT_PENDING",
  "DISBURSED",
]);

/**
 * Option registries for Modules 06-07.
 *
 * Values come from the schemas above via `.options` rather than being retyped,
 * which is what stops a dropdown and the validator guarding the same field from
 * drifting apart. The labels are the wording already in use in `LoanBadges.tsx`,
 * moved here so badges and dropdowns cannot disagree.
 */
/**
 * The loan types every tenant starts with — a *fallback*, not the list.
 *
 * Loan types are master data now, so the authoritative list for a tenant comes
 * from the API and may contain codes this file has never heard of. These four
 * are the ones the migration seeds, and they remain here for one job only:
 * turning a stored code into a readable label on screens that render a saved
 * application without fetching the option list (`labelFor` falls back to the
 * code itself for anything absent, so a tenant-defined type still displays,
 * just as its code).
 *
 * Do NOT use this to populate a Loan Type dropdown — that must come from the
 * API, or a tenant's own types are silently unofferable.
 */
export const LOAN_TYPE_OPTIONS = optionsFrom(
  ["PERSONAL", "BUSINESS", "GOLD", "VEHICLE"] as const,
  {
    PERSONAL: "Personal",
    BUSINESS: "Business",
    GOLD: "Gold",
    VEHICLE: "Vehicle",
  },
);

export const INTEREST_TYPE_OPTIONS = optionsFrom(interestTypeSchema.options, {
  FLAT: "Flat",
  REDUCING: "Reducing balance",
  CUSTOM_RATE: "Custom rate",
});

export const REPAYMENT_FREQUENCY_OPTIONS = optionsFrom(
  repaymentFrequencySchema.options,
  {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    YEARLY: "Yearly",
  },
);

export const LOAN_CONFIG_STATUS_OPTIONS = optionsFrom(
  loanConfigStatusSchema.options,
  { DRAFT: "Draft", ACTIVE: "Active", INACTIVE: "Inactive" },
);

export const APPLICATION_STATUS_OPTIONS = optionsFrom(
  applicationStatusSchema.options,
  {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    UNDER_REVIEW: "Under review",
    MORE_INFO_REQUIRED: "More info needed",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    SANCTIONED: "Sanctioned",
    CUSTOMER_ACCEPTED: "Customer accepted",
    AGREEMENT_SIGNED: "Agreement signed",
    DISBURSEMENT_PENDING: "Awaiting disbursal",
    DISBURSED: "Disbursed",
  },
);

/**
 * A money amount in integer paise, carried as a digit string.
 *
 * Rejects a decimal point outright rather than trying to interpret it: "1000.50"
 * from a caller who meant rupees and "1000.50" from a caller who meant paise are
 * indistinguishable here, and guessing between them is how a loan gets funded at
 * a hundredth of its intended size.
 */
export const paiseString = (label: string) =>
  z
    .string({
      required_error: `${label} is required`,
      invalid_type_error: `${label} is required`,
    })
    .trim()
    .min(1, `${label} is required`)
    // `superRefine` rather than a chained `.refine()`: a plain refinement still
    // runs after the format check has already failed, so `BigInt("abc")` would
    // throw a raw SyntaxError out of the schema instead of producing a
    // validation error. Doing both checks in one pass, and bailing after the
    // first, keeps a malformed amount a 400 rather than a 500.
    .superRefine((value, ctx) => {
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a whole number of paise`,
        });
        return;
      }
      if (value.replace(/^0+/, "").length > 18) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} is too large`,
        });
      }
    });

/** Integer basis points as a digit string. 10000 bps = 100%. */
const bpsString = (label: string) =>
  z
    .string({
      required_error: `${label} is required`,
      invalid_type_error: `${label} is required`,
    })
    .trim()
    .min(1, `${label} is required`)
    .superRefine((value, ctx) => {
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a whole number of basis points`,
        });
        return;
      }
      if (BigInt(value) > 1_000_000n) {
        // 10,000% a year. Not a business limit — just a bound past which the
        // figure is certainly a data-entry error rather than a punitive rate.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} is unreasonably high`,
        });
      }
    });

/**
 * A paise amount that must also be strictly greater than zero (Rule 9).
 *
 * Built on `paiseString` with `superRefine` for the same short-circuit reason:
 * chaining `.refine(BigInt(value) > 0n)` would evaluate on a non-numeric string
 * that had already failed the digit check, and throw instead of reporting.
 */
export const positivePaise = (label: string) =>
  paiseString(label).superRefine((value, ctx) => {
    if (/^\d+$/.test(value) && BigInt(value) === 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be greater than zero`,
      });
    }
  });

/**
 * A paise amount that may legitimately be zero, and whose field may be blank.
 *
 * The case this exists for is one side of a journal line. A line is a debit or
 * a credit, never both, so exactly one of the two fields is always empty — and
 * "empty" has the same two spellings as everywhere else: an untouched input
 * submits `""`, and a field the form did not render makes `formData.get()`
 * return `null`. Both normalize to `"0"` rather than to `undefined`, because
 * the consumer sums these and a missing side means zero, not unknown.
 *
 * `positivePaise` is wrong here for the obvious reason and `paiseString` is
 * wrong for a subtler one: it requires the field to be present, so the blank
 * half of every line would fail before the line-level rule that actually
 * decides which half is allowed to be blank ever ran.
 */
export const paiseOrZero = (label: string) =>
  z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? "0" : value,
    paiseString(label),
  );

/** A positive whole number of repayment periods. */
const durationCountSchema = z.coerce
  .number({ invalid_type_error: "Duration is required" })
  .int("Duration must be a whole number of periods")
  .min(1, "Duration must be at least one period")
  .max(10_000, "Duration is too long");

/**
 * The optimistic-concurrency token every mutating request carries.
 *
 * It is the record's ISO `updatedAt`. Validated as a parseable timestamp here so
 * a malformed value is a 400 at the edge rather than an opaque failed match deep
 * in a transaction.
 */
export const expectedVersionSchema = z
  .string()
  .trim()
  .min(1, "This form is out of date. Reload and try again.")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "This form is out of date. Reload and try again.",
  });

const codeSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(50, `${label} must be 50 characters or fewer`)
    .regex(
      /^[A-Z0-9][A-Z0-9_-]*$/,
      `${label} may use A-Z, 0-9, hyphen and underscore only`,
    );

const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(150, `${label} must be 150 characters or fewer`);

// ---------------------------------------------------------------------------
// Module 06 — Loan products and schemes
// ---------------------------------------------------------------------------

export const createLoanProductSchema = z.object({
  code: codeSchema("Product Code"),
  name: nameSchema("Product Name"),
  loanType: loanTypeSchema,
});

/** Code is absent: an identifier other records already reference cannot be edited. */
export const updateLoanProductSchema = z.object({
  name: nameSchema("Product Name"),
  loanType: loanTypeSchema,
  expectedVersion: expectedVersionSchema,
});

export const createLoanSchemeSchema = z.object({
  loanProductId: z.string().uuid("Select a loan product"),
  code: codeSchema("Scheme Code"),
  name: nameSchema("Scheme Name"),
  interestType: interestTypeSchema,
  interestRateBps: bpsString("Interest Rate"),
});

/**
 * The product a scheme belongs to is absent: moving a scheme between products
 * would silently re-type every application already created against it.
 */
export const updateLoanSchemeSchema = z.object({
  name: nameSchema("Scheme Name"),
  interestType: interestTypeSchema,
  interestRateBps: bpsString("Interest Rate"),
  expectedVersion: expectedVersionSchema,
});

export const setLoanConfigStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"], {
    errorMap: () => ({ message: "Status is required" }),
  }),
  reason: optionalText(500),
  expectedVersion: expectedVersionSchema,
});

/**
 * A repayment option a scheme offers.
 *
 * The optional bounds turn one row into a range of accepted counts, for a term
 * the borrower states rather than picks — a daily loan runs to a date, so its
 * count is whatever those dates imply. Both or neither: one alone would behave
 * as an exact term while looking like a range, so the refinement below refuses
 * it rather than letting the admin believe a range was saved. The API repeats
 * every rule here, and the database repeats them again as a CHECK constraint.
 */
export const createSchemeDurationSchema = z
  .object({
    frequency: repaymentFrequencySchema,
    durationCount: durationCountSchema,
    minDurationCount: durationCountSchema.optional(),
    maxDurationCount: durationCountSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const { minDurationCount: min, maxDurationCount: max } = value;

    if (min === undefined && max === undefined) return;

    if (min === undefined || max === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [min === undefined ? "minDurationCount" : "maxDurationCount"],
        message: "Give both a minimum and a maximum duration, or neither",
      });
      return;
    }

    if (min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxDurationCount"],
        message: "Minimum duration cannot exceed the maximum",
      });
      return;
    }

    // The default is what the application form pre-fills; outside its own range
    // it would offer a value the submit gate then refuses.
    if (value.durationCount < min || value.durationCount > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationCount"],
        message: "Default duration must fall within the minimum and maximum",
      });
    }
  });

export const updateSchemeDurationSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"], {
    errorMap: () => ({ message: "Status is required" }),
  }),
});

// ---------------------------------------------------------------------------
// Module 07 — Loan applications
// ---------------------------------------------------------------------------

/**
 * Wizard steps 1-3, submitted together.
 *
 * There is deliberately no "create an empty draft" schema. `LoanApplication` has
 * nine non-null columns, so a row cannot exist until customer, amount and terms
 * are all chosen; the alternative — making them nullable for the draft's sake —
 * would force every later reader, through approval and disbursal, to null-check
 * columns that are populated for every row that ever reaches them (D-APP-1).
 */
export const createLoanApplicationSchema = z.object({
  customerId: z.string().uuid("Select a customer"),
  loanSchemeId: z.string().uuid("Select a loan scheme"),
  requestedAmountPaise: positivePaise("Loan Amount"),
  purpose: z
    .string({
      required_error: "Purpose is required",
      invalid_type_error: "Purpose is required",
    })
    .trim()
    .min(1, "Purpose is required")
    .max(500, "Purpose must be 500 characters or fewer"),
  interestType: interestTypeSchema,
  interestRateBps: bpsString("Interest Rate"),
  repaymentFrequency: repaymentFrequencySchema,
  durationCount: durationCountSchema,
});

/**
 * The wizard's steps, as slices of the schema above.
 *
 * `.pick()` rather than fresh schemas, so there is one definition of what a
 * valid amount or duration is. The wizard's Next button and the server action
 * that finally creates the row then move together: change a bound in
 * `createLoanApplicationSchema` and both enforce the new one. Hand-written
 * per-step booleans — which is what the wizard used to carry — drift the moment
 * a rule changes, and drift *silently*, because the server still rejects what
 * the client waved through.
 *
 * The fourth step (EMI preview) has no fields of its own: it gates on the
 * server having actually returned a schedule, which no schema can express.
 *
 * Client-side these are error *prevention*. The server still validates the
 * whole `createLoanApplicationSchema` on submit — a step slice passing is not
 * permission to skip that.
 */
export const loanApplicationStepSchemas = {
  customer: createLoanApplicationSchema.pick({ customerId: true }),
  details: createLoanApplicationSchema.pick({
    requestedAmountPaise: true,
    purpose: true,
  }),
  terms: createLoanApplicationSchema.pick({
    loanSchemeId: true,
    interestType: true,
    interestRateBps: true,
    repaymentFrequency: true,
    durationCount: true,
  }),
} as const;

/** Step order. The URL carries these slugs, so they are a public contract. */
export const LOAN_APPLICATION_STEPS = [
  "customer",
  "details",
  "terms",
  "preview",
] as const;

export type LoanApplicationStep = (typeof LOAN_APPLICATION_STEPS)[number];

/**
 * Draft edits. The customer is absent: changing who an application is for turns
 * it into a different application, and would strand any documents already
 * uploaded against the original borrower.
 */
export const updateLoanApplicationSchema = createLoanApplicationSchema
  .omit({ customerId: true })
  .extend({ expectedVersion: expectedVersionSchema });

/** Stateless preview for wizard step 4; touches no stored record. */
export const emiPreviewSchema = z.object({
  principalPaise: positivePaise("Loan Amount"),
  annualRateBps: bpsString("Interest Rate"),
  interestType: interestTypeSchema,
  frequency: repaymentFrequencySchema,
  durationCount: durationCountSchema,
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD")
    .optional(),
});

/** Every lifecycle transition carries the version it believes it is acting on. */
export const applicationTransitionSchema = z.object({
  expectedVersion: expectedVersionSchema,
});

export const requestMoreInfoSchema = z.object({
  /**
   * Required, unlike most comment fields: "provide more information" without
   * saying which information is a round trip that helps nobody (Scenario 22).
   */
  comments: z
    .string({
      required_error: "Describe what is needed",
      invalid_type_error: "Describe what is needed",
    })
    .trim()
    .min(1, "Describe what is needed")
    .max(1000, "Comments must be 1000 characters or fewer"),
  expectedVersion: expectedVersionSchema,
});

export const modifyTermsSchema = z.object({
  interestType: interestTypeSchema,
  interestRateBps: bpsString("Interest Rate"),
  repaymentFrequency: repaymentFrequencySchema,
  durationCount: durationCountSchema,
  comments: z
    .string({
      required_error: "Record why the terms changed",
      invalid_type_error: "Record why the terms changed",
    })
    .trim()
    .min(1, "Record why the terms changed")
    .max(1000, "Comments must be 1000 characters or fewer"),
  expectedVersion: expectedVersionSchema,
});

export const approveApplicationSchema = z.object({
  comments: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

export const rejectApplicationSchema = z.object({
  /**
   * Mandatory, and separate from `comments` (Rule 40, Scenario 27). The unified
   * REJECTED status carries no information on its own; the reason is the record.
   */
  rejectionReason: z
    .string({
      required_error: "Rejection Reason is required",
      invalid_type_error: "Rejection Reason is required",
    })
    .trim()
    .min(1, "Rejection Reason is required")
    .max(1000, "Rejection Reason must be 1000 characters or fewer"),
  comments: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

// --- Module 08: Approval Workflow -------------------------------------------

export const creditAssessmentResultSchema = z.enum(
  ["PASS", "FAIL", "MANUAL_REVIEW"],
  { errorMap: () => ({ message: "Assessment Result is required" }) },
);

export const CREDIT_ASSESSMENT_RESULT_OPTIONS = optionsFrom(
  creditAssessmentResultSchema.options,
  { PASS: "Pass", FAIL: "Fail", MANUAL_REVIEW: "Manual review" },
);

/**
 * Record a credit assessment (Scenarios 7, 9).
 *
 * `assessmentResult` has no default. A default of PASS would be Scenario 9
 * implemented backwards in one line.
 */
export const recordCreditAssessmentSchema = z.object({
  cibilScore: z
    .union([z.literal(""), z.coerce.number().int().min(300).max(900)])
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  /**
   * Parsed from the literal strings a form sends, never coerced.
   * `z.coerce.boolean()` applies `Boolean("false")`, which is `true` — turning
   * every failed income check into a passed one.
   */
  incomeVerified: z.enum(["true", "false"], {
    errorMap: () => ({ message: "Income Check is required" }),
  }),
  incomeMonthlyPaise: optionalText(19),
  assessmentResult: creditAssessmentResultSchema,
  assessmentNotes: optionalText(2000),
});

export const issueSanctionSchema = z.object({
  /** Recorded, not enforced: the source defines no expiry behaviour. */
  validUntil: optionalText(10),
  notes: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

export const acceptSanctionSchema = z.object({
  comments: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

/**
 * The customer declined (Scenario 32).
 *
 * The reason is mandatory for the reason `rejectApplicationSchema`'s is: the
 * decline lands on the unified REJECTED status, which carries no information
 * on its own.
 */
export const declineSanctionSchema = z.object({
  declineReason: z
    .string({
      required_error: "Decline Reason is required",
      invalid_type_error: "Decline Reason is required",
    })
    .trim()
    .min(1, "Decline Reason is required")
    .max(1000, "Decline Reason must be 1000 characters or fewer"),
  comments: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

export const recordAgreementSchema = z.object({
  signedDate: optionalText(10),
  agreementReference: optionalText(100),
  comments: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

/**
 * The three categories the source names for application support (Rule 34).
 *
 * Deliberately a different enum from `kycDocumentTypeSchema`: borrower identity
 * documents and loan-support documents live in different tables under different
 * permissions, and one shared enum is exactly how a reviewer's reach would widen
 * by accident.
 */
export const applicationDocumentTypeSchema = z.enum(
  ["ID", "INCOME", "COLLATERAL"],
  {
    errorMap: () => ({ message: "Document Type is required" }),
  },
);

/** Labels stay distinct from the KYC ones for the reason given above the schema. */
export const APPLICATION_DOCUMENT_TYPE_OPTIONS = optionsFrom(
  applicationDocumentTypeSchema.options,
  { ID: "Identity Proof", INCOME: "Income Proof", COLLATERAL: "Collateral" },
);

export const uploadApplicationDocumentSchema = z.object({
  documentType: applicationDocumentTypeSchema,
  documentNumber: optionalText(100),
});

/**
 * Verify or reject one document.
 *
 * The reason is conditionally required, expressed as a refinement rather than a
 * per-field rule so it reports against the field the user must fill in.
 */
export const verifyApplicationDocumentSchema = z
  .object({
    status: z.enum(["VERIFIED", "REJECTED"], {
      errorMap: () => ({ message: "Decision is required" }),
    }),
    verificationReason: optionalText(500),
  })
  .refine(
    (value) => value.status !== "REJECTED" || Boolean(value.verificationReason),
    {
      message: "Give a reason when rejecting a document",
      path: ["verificationReason"],
    },
  );

/** List filters. Absent values mean "no filter", never "match nothing". */
export const listLoanApplicationsSchema = z.object({
  search: optionalText(100),
  status: applicationStatusSchema.optional(),
  loanType: loanTypeSchema.optional(),
  customerId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "From date must be YYYY-MM-DD")
    .optional(),
  toDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "To date must be YYYY-MM-DD")
    .optional(),
});

export type CreateLoanProductInput = z.infer<typeof createLoanProductSchema>;
export type UpdateLoanProductInput = z.infer<typeof updateLoanProductSchema>;
export type CreateLoanSchemeInput = z.infer<typeof createLoanSchemeSchema>;
export type UpdateLoanSchemeInput = z.infer<typeof updateLoanSchemeSchema>;
export type SetLoanConfigStatusInput = z.infer<
  typeof setLoanConfigStatusSchema
>;
export type CreateSchemeDurationInput = z.infer<
  typeof createSchemeDurationSchema
>;
export type UpdateSchemeDurationInput = z.infer<
  typeof updateSchemeDurationSchema
>;
export type CreateLoanApplicationInput = z.infer<
  typeof createLoanApplicationSchema
>;
export type UpdateLoanApplicationInput = z.infer<
  typeof updateLoanApplicationSchema
>;
export type EmiPreviewInput = z.infer<typeof emiPreviewSchema>;
export type ApplicationTransitionInput = z.infer<
  typeof applicationTransitionSchema
>;
export type RequestMoreInfoInput = z.infer<typeof requestMoreInfoSchema>;
export type ModifyTermsInput = z.infer<typeof modifyTermsSchema>;
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;
export type UploadApplicationDocumentInput = z.infer<
  typeof uploadApplicationDocumentSchema
>;
export type VerifyApplicationDocumentInput = z.infer<
  typeof verifyApplicationDocumentSchema
>;
export type ListLoanApplicationsInput = z.infer<
  typeof listLoanApplicationsSchema
>;
