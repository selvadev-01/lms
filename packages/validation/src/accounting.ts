import { z } from "zod";

import { expectedVersionSchema, paiseOrZero } from "./loans";
import { optionsFrom } from "./options";
import { isoDateSchema, optionalText, statusSchema } from "./primitives";

/**
 * Module 14 schemas — accounting and ledger.
 *
 * Same cycle-avoiding rule as every other module file: imports reach `./loans`,
 * `./options` and `./primitives` directly, never `./index`.
 *
 * Four things are specific to this module.
 *
 * **Nothing that decides scope is accepted from the client.** There is no
 * `orgId` or `branchId` in any schema here. The organization comes from the
 * JWT and the branch from the actor's scope, which is what makes "a client
 * cannot post into another branch" structural rather than a check somebody has
 * to remember to write. The API's `forbidNonWhitelisted` turns an attempt to
 * send one into a 400.
 *
 * **Only two entry types are authorable.** `JournalEntryType` has fifteen
 * members; thirteen of them are owned by a source module and are written by
 * `LedgerService`, never by a person. `manualJournalTypeSchema` offers the two
 * that are, so a hand-authored journal cannot claim to be a disbursal.
 *
 * **Money is integer paise as a digit string, and totals are compared with
 * `BigInt`.** Never `Number`: a rupee total above about ninety thousand crore
 * loses paise in a double, and a balance check that is off by one paise is
 * exactly the bug this module exists to make impossible. `BigInt(0)` is written
 * out rather than `0n` because `apps/web` targets ES2017, where the literal is
 * a syntax error.
 *
 * **These schemas run in the browser.** They are not what guards the API — the
 * DTOs are, and the database triggers are what guarantee the invariants
 * underneath both. A rule written only here is enforced only here.
 */

// --- Enums -------------------------------------------------------------------

/**
 * The five account types.
 *
 * Mirrors the Prisma `AccountType` enum exactly. The message lives on the enum
 * rather than on a `.min(1)` because an untouched `<select>` posts `""`, which
 * fails the enum and never reaches a length rule.
 */
export const accountTypeSchema = z.enum(
  ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"],
  { errorMap: () => ({ message: "Account Type is required" }) },
);

export const normalBalanceSchema = z.enum(["DEBIT", "CREDIT"], {
  errorMap: () => ({ message: "Normal Balance is required" }),
});

export const accountBranchScopeSchema = z.enum(["ORGANIZATION", "BRANCH"], {
  errorMap: () => ({ message: "Branch Scope is required" }),
});

export const journalEntryStatusSchema = z.enum(["DRAFT", "POSTED", "REVERSED"]);

/**
 * The entry types a person may author.
 *
 * Deliberately two of the fifteen `JournalEntryType` members. The other
 * thirteen — DISBURSEMENT, COLLECTION, REVERSAL and the rest — describe events
 * a source module owns and posts through `LedgerService`. Offering them here
 * would let a hand-written journal masquerade as a disbursal, which would then
 * reconcile against a source transaction that does not exist.
 */
export const manualJournalTypeSchema = z.enum(["MANUAL", "ADJUSTMENT"], {
  errorMap: () => ({ message: "Journal Type is required" }),
});

// --- Option lists ------------------------------------------------------------

export const ACCOUNT_TYPE_OPTIONS = optionsFrom(accountTypeSchema.options, {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
});

export const NORMAL_BALANCE_OPTIONS = optionsFrom(normalBalanceSchema.options, {
  DEBIT: "Debit",
  CREDIT: "Credit",
});

export const ACCOUNT_STATUS_OPTIONS = optionsFrom(statusSchema.options, {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
});

export const ACCOUNT_BRANCH_SCOPE_OPTIONS = optionsFrom(
  accountBranchScopeSchema.options,
  {
    ORGANIZATION: "Whole organization",
    BRANCH: "Single branch",
  },
);

export const JOURNAL_STATUS_OPTIONS = optionsFrom(
  journalEntryStatusSchema.options,
  {
    DRAFT: "Draft",
    POSTED: "Posted",
    REVERSED: "Reversed",
  },
);

export const MANUAL_JOURNAL_TYPE_OPTIONS = optionsFrom(
  manualJournalTypeSchema.options,
  {
    MANUAL: "Manual journal",
    ADJUSTMENT: "Adjustment",
  },
);

/**
 * A required account reference.
 *
 * `required_error` and `invalid_type_error` are both set, and both to the same
 * message: an omitted field and a field the form rendered but nobody touched
 * are the same problem to the person filling it in, and zod's default
 * "Required" names neither the field nor the fix.
 */
const requiredAccountId = z
  .string({
    required_error: "Account is required",
    invalid_type_error: "Account is required",
  })
  .min(1, "Account is required")
  .uuid("Account is required");

// --- Chart of accounts -------------------------------------------------------

/**
 * An account code, unique within the organization's chart.
 *
 * Restricted to characters that survive a URL, a filename and a CSV export
 * unescaped, for the same reason `branchCodeSchema` is: these codes appear in
 * exported trial balances and in report filenames.
 */
export const accountCodeSchema = z
  .string()
  .trim()
  .min(1, "Account Code is required")
  .max(50, "Account Code is too long")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Account Code may use letters, digits, dot, underscore and hyphen",
  );

/**
 * The conventional side of each account type.
 *
 * An asset that normally carries a credit balance is almost always a data-entry
 * slip rather than an exotic accounting choice, and catching it at the form is
 * far cheaper than discovering it in a trial balance that will not tie out.
 */
const CONVENTIONAL_NORMAL_BALANCE: Record<
  z.infer<typeof accountTypeSchema>,
  z.infer<typeof normalBalanceSchema>
> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  INCOME: "CREDIT",
};

const accountFields = {
  accountCode: accountCodeSchema,
  accountName: z
    .string()
    .trim()
    .min(1, "Account Name is required")
    .max(200, "Account Name is too long"),
  accountType: accountTypeSchema,
  normalBalance: normalBalanceSchema,
  accountCategory: optionalText(100),
  parentAccountId: z.string().uuid().optional(),
  description: optionalText(1000),
  isPostable: z.coerce.boolean().default(true),
  isManualPostingAllowed: z.coerce.boolean().default(false),
  isControlAccount: z.coerce.boolean().default(false),
  branchScope: accountBranchScopeSchema.default("ORGANIZATION"),
  status: statusSchema,
  effectiveFrom: isoDateSchema("Effective From").optional(),
  effectiveTo: isoDateSchema("Effective To").optional(),
};

/**
 * Cross-field rules for an account, applied to create and edit alike.
 *
 * Written as a shared function rather than duplicated because `updateAccount`
 * is a partial of the same shape, and a rule enforced on create but not on edit
 * is a rule that can be got around by creating and then editing.
 */
function refineAccount(
  value: {
    accountType?: z.infer<typeof accountTypeSchema>;
    normalBalance?: z.infer<typeof normalBalanceSchema>;
    isPostable?: boolean;
    isControlAccount?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    value.effectiveFrom &&
    value.effectiveTo &&
    value.effectiveTo < value.effectiveFrom
  ) {
    // String comparison is exact for YYYY-MM-DD and avoids constructing two
    // Dates purely to order them.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Effective To must be on or after Effective From",
      path: ["effectiveTo"],
    });
  }

  if (value.isControlAccount && value.isPostable) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A control account is driven by its subsidiary ledger and cannot be posted to directly",
      path: ["isPostable"],
    });
  }

  if (
    value.accountType &&
    value.normalBalance &&
    CONVENTIONAL_NORMAL_BALANCE[value.accountType] !== value.normalBalance
  ) {
    // "An asset", not "a asset". Chosen from the word rather than hardcoded
    // because ASSET, EQUITY, INCOME and EXPENSE all take "an" while LIABILITY
    // does not. Must match the API's wording in `account.service.ts`.
    const article = /^[AEIOU]/.test(value.accountType) ? "An" : "A";
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${article} ${value.accountType.toLowerCase()} account normally carries a ${CONVENTIONAL_NORMAL_BALANCE[
        value.accountType
      ].toLowerCase()} balance`,
      path: ["normalBalance"],
    });
  }
}

export const createAccountSchema = z
  .object(accountFields)
  .superRefine(refineAccount);

/**
 * Account edit.
 *
 * `accountCode`, `accountType` and `normalBalance` remain in the shape rather
 * than being omitted, because whether they may change depends on data the
 * client does not have: an account with posted lines has its identity frozen,
 * and one without does not. The server decides and answers 409; omitting them
 * here would instead make an attempt to change them silently succeed as a no-op.
 */
export const updateAccountSchema = z
  .object(accountFields)
  .partial()
  .extend({ expectedVersion: expectedVersionSchema })
  .superRefine(refineAccount);

export const deactivateAccountSchema = z.object({
  reason: optionalText(500),
  expectedVersion: expectedVersionSchema,
});

export const activateAccountSchema = z.object({
  expectedVersion: expectedVersionSchema,
});

export const listAccountsSchema = z.object({
  search: optionalText(200),
  accountType: accountTypeSchema.optional(),
  status: statusSchema.optional(),
  postableOnly: z.coerce.boolean().optional(),
  manualPostableOnly: z.coerce.boolean().optional(),
});

// --- Journal entries ---------------------------------------------------------

/**
 * One line of a journal.
 *
 * A line is a debit or a credit, never both and never neither. That rule is
 * enforced here, again in the API DTO, and a third time by the
 * `journal_lines_shape` database trigger — three layers, because a line that
 * violates it is a data-entry error at the moment it is written and no later
 * step can redeem it.
 */
export const journalLineSchema = z
  .object({
    accountId: requiredAccountId,
    debitPaise: paiseOrZero("Debit"),
    creditPaise: paiseOrZero("Credit"),
    description: optionalText(500),
  })
  .superRefine((value, ctx) => {
    // An object-level superRefine still runs after a field's own checks have
    // failed, so a malformed amount is still the raw input here. `BigInt` on
    // it would throw a SyntaxError out of the schema — a 500 where the field
    // rule has already produced the right 400. Bail instead.
    if (!/^\d+$/.test(value.debitPaise) || !/^\d+$/.test(value.creditPaise)) {
      return;
    }

    const debit = BigInt(value.debitPaise);
    const credit = BigInt(value.creditPaise);
    const zero = BigInt(0);

    if (debit > zero && credit > zero) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A line is either a debit or a credit, not both",
        path: ["debitPaise"],
      });
      return;
    }

    if (debit === zero && credit === zero) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a debit or a credit amount",
        path: ["debitPaise"],
      });
    }
  });

/**
 * Cross-line rules: what makes a set of lines a journal rather than a list.
 *
 * Mirrors the database's `assert_entry_postable` deliberately. The duplication
 * is the same one `LedgerService.assertBalanced` documents: this produces the
 * message a person can act on, and the trigger is the guarantee. If the two
 * ever disagree, the trigger wins and nothing is written.
 */
function refineJournalLines(
  lines: z.infer<typeof journalLineSchema>[],
  ctx: z.RefinementCtx,
): void {
  // Same short-circuit as the line rule above: if any amount is still
  // malformed, its own field check has already reported and summing would
  // throw. Totals across a set that contains a non-number are meaningless
  // anyway.
  const summable = lines.every(
    (line) => /^\d+$/.test(line.debitPaise) && /^\d+$/.test(line.creditPaise),
  );
  if (!summable) return;

  const zero = BigInt(0);
  let totalDebit = zero;
  let totalCredit = zero;
  let debitLines = 0;
  let creditLines = 0;

  for (const line of lines) {
    const debit = BigInt(line.debitPaise);
    const credit = BigInt(line.creditPaise);
    totalDebit += debit;
    totalCredit += credit;
    if (debit > zero) debitLines += 1;
    if (credit > zero) creditLines += 1;
  }

  if (debitLines === 0 || creditLines === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A journal needs at least one debit line and one credit line",
      path: ["lines"],
    });
    return;
  }

  if (totalDebit !== totalCredit) {
    // Reported in rupees because that is the unit the operator typed in.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total debit must equal total credit. They differ by ${formatPaiseDifference(
        totalDebit - totalCredit,
      )}.`,
      path: ["lines"],
    });
  }

  // A repeated account on the same side is almost always a duplicated row
  // rather than an intent, and merging them silently would hide it.
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const side = BigInt(line.debitPaise) > zero ? "D" : "C";
    const key = `${line.accountId}:${side}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This account already has a line on the same side",
        path: ["lines", index, "accountId"],
      });
    }
    seen.add(key);
  });
}

/** Renders a signed paise difference as rupees, for a validation message. */
function formatPaiseDifference(difference: bigint): string {
  const magnitude = difference < BigInt(0) ? -difference : difference;
  const hundred = BigInt(100);
  const rupees = magnitude / hundred;
  const paise = magnitude % hundred;
  return `₹${rupees.toString()}.${paise.toString().padStart(2, "0")}`;
}

const journalFields = {
  entryDate: isoDateSchema("Business Date"),
  entryType: manualJournalTypeSchema,
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(1000, "Description is too long"),
  lines: z
    .array(journalLineSchema)
    .min(1, "At least one journal line is required"),
  adjustmentReason: optionalText(1000),
  approvalReference: optionalText(150),
};

/**
 * Cross-field rules for a journal, shared by create and edit.
 *
 * An ADJUSTMENT without a reason is the case this exists for: an adjustment is
 * a correction to something already posted, and a correction whose reason is
 * not recorded cannot be reviewed later.
 */
function refineJournal(
  value: {
    entryType?: z.infer<typeof manualJournalTypeSchema>;
    adjustmentReason?: string;
    lines?: z.infer<typeof journalLineSchema>[];
  },
  ctx: z.RefinementCtx,
): void {
  if (value.entryType === "ADJUSTMENT" && !value.adjustmentReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An adjustment needs a reason",
      path: ["adjustmentReason"],
    });
  }

  if (value.lines && value.lines.length > 0) {
    refineJournalLines(value.lines, ctx);
  }
}

/**
 * Create a draft journal.
 *
 * Carries an `idempotencyKey` the client mints once per form, so a double
 * submit returns the draft that already exists rather than creating a second
 * one. It is not an `expectedVersion`: there is no prior row for the request to
 * be stale against.
 */
export const createJournalSchema = z
  .object({
    ...journalFields,
    idempotencyKey: z.string().uuid(),
  })
  .superRefine(refineJournal);

/**
 * Edit a draft journal.
 *
 * Lines are replaced wholesale rather than patched. A journal is meaningful
 * only as a balanced set, so a partial line update would have to be validated
 * against rows the request did not send.
 */
export const updateJournalSchema = z
  .object({
    ...journalFields,
    expectedVersion: expectedVersionSchema,
  })
  .superRefine(refineJournal);

/**
 * Validate a draft without saving it.
 *
 * The same shape as create, minus the idempotency key: nothing is written, so
 * there is nothing to deduplicate.
 */
export const validateJournalSchema = z
  .object(journalFields)
  .superRefine(refineJournal);

export const postJournalSchema = z.object({
  expectedVersion: expectedVersionSchema,
});

/**
 * Reverse a posted journal.
 *
 * The reason is required, unlike most reason fields in the app. A reversal
 * unwinds a committed financial posting, and the audit trail has to answer
 * "why" without a second query.
 *
 * `entryDate` is optional and defaults server-side to today's Asia/Kolkata
 * business date. When supplied it may not precede the original's date —
 * reversing into a period that has already been reported would rewrite a
 * published figure.
 */
export const reverseJournalSchema = z.object({
  reversalReason: z
    .string()
    .trim()
    .min(1, "Reversal Reason is required")
    .max(1000, "Reversal Reason is too long"),
  entryDate: isoDateSchema("Business Date").optional(),
  expectedVersion: expectedVersionSchema,
});

export const listJournalsSchema = z.object({
  search: optionalText(200),
  status: journalEntryStatusSchema.optional(),
  entryType: optionalText(50),
  sourceType: optionalText(50),
  accountId: z.string().uuid().optional(),
  fromDate: isoDateSchema("From Date").optional(),
  toDate: isoDateSchema("To Date").optional(),
});

// --- General ledger ----------------------------------------------------------

/**
 * A general-ledger query.
 *
 * `accountId` is required, and that is a design choice rather than an
 * omission: a ledger with no account filter is a journal listing, which the
 * journals endpoint already is. Requiring it also bounds the query.
 *
 * There is no `branchId`. Branch confinement is applied server-side from the
 * actor's scope, and the absence of the field is what makes a client-supplied
 * branch a 400 rather than a leak.
 */
export const generalLedgerQuerySchema = z.object({
  accountId: requiredAccountId,
  fromDate: isoDateSchema("From Date").optional(),
  toDate: isoDateSchema("To Date").optional(),
  sourceType: optionalText(50),
});

export const trialBalanceQuerySchema = z.object({
  asOfDate: isoDateSchema("As Of Date").optional(),
  fromDate: isoDateSchema("From Date").optional(),
  includeZero: z.coerce.boolean().optional(),
});

export const reconciliationQuerySchema = z.object({
  fromDate: isoDateSchema("From Date"),
  toDate: isoDateSchema("To Date"),
  sourceType: optionalText(50),
});

// --- Inferred types ----------------------------------------------------------

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type DeactivateAccountInput = z.infer<typeof deactivateAccountSchema>;
export type ActivateAccountInput = z.infer<typeof activateAccountSchema>;
export type ListAccountsInput = z.infer<typeof listAccountsSchema>;
export type JournalLineInput = z.infer<typeof journalLineSchema>;
export type CreateJournalInput = z.infer<typeof createJournalSchema>;
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;
export type ValidateJournalInput = z.infer<typeof validateJournalSchema>;
export type PostJournalInput = z.infer<typeof postJournalSchema>;
export type ReverseJournalInput = z.infer<typeof reverseJournalSchema>;
export type ListJournalsInput = z.infer<typeof listJournalsSchema>;
export type GeneralLedgerQueryInput = z.infer<typeof generalLedgerQuerySchema>;
export type TrialBalanceQueryInput = z.infer<typeof trialBalanceQuerySchema>;
export type ReconciliationQueryInput = z.infer<
  typeof reconciliationQuerySchema
>;
