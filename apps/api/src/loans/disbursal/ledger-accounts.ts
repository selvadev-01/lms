/**
 * The chart of accounts Modules 09 and 11 post to.
 *
 * # Why this file exists rather than string literals in the service
 *
 * The seed creates these rows and `LedgerService` looks them up. If each named
 * its own codes, a renamed account in one place would surface as a runtime
 * "account not found" in the other — during a money-moving transaction, which
 * is the worst possible time to discover a typo. One definition, two importers.
 *
 * # Why only seven accounts
 *
 * Module 09 answers Q-DOM-33 with the narrowest mapping the source supports.
 * The user story says only:
 *
 *   Debit  = configured loan-disbursement/loan receivable account
 *   Credit = configured bank/cash funding account
 *
 * and explicitly leaves the full chart of accounts to be "confirmed before
 * implementation". Module 11 adds the three income accounts a repayment needs
 * and nothing more. Module 12 adds one: Field Agent Cash in Hand, because cash
 * an agent is carrying is genuinely not the same asset as cash in the branch
 * drawer. Module 14 (Accounting & Ledger) owns the real chart, its CRUD and its
 * hierarchy. Seeding fixed accounts here is what lets disbursal, collection and
 * cash custody post balanced entries today without pre-empting that design.
 *
 * # Why a collection credits income, not "interest receivable"
 *
 * Module 11's source says a receipt should credit "the applicable penalty
 * receivable, interest receivable, principal receivable and fee receivable
 * accounts". That wording describes a system that accrues interest as a
 * receivable when it falls due. **This system does not.**
 *
 * `postDisbursement` debits Loan Receivable for the sanctioned amount, which is
 * principal only — interest is never booked as an asset at any point. Crediting
 * an "interest receivable" on collection would therefore drive an account that
 * has no balance increasingly negative, and the balance sheet would be wrong by
 * the cumulative interest ever collected.
 *
 * The correct treatment, and the one implemented here: a repayment credits Loan
 * Receivable for **only the principal portion** — retiring the asset that was
 * actually created — and recognises interest, penalty and fees as **income at
 * the moment of collection**. That is cash-basis income recognition, which is
 * the honest description of what this ledger does today. When Module 14
 * introduces accrual, it will add the receivable accounts and the accrual
 * entries together, and this mapping changes with it.
 *
 * These are deliberately NOT branch-scoped. Which branch a posting belongs to
 * is carried by the `AccountDimension` on each journal line, not by owning a
 * separate account per branch — that is what the dimension table is for, and
 * duplicating accounts per branch would make a consolidated trial balance a
 * join rather than a sum.
 */

import type { PaymentMode } from '@lms/types';

/** Asset. Debited on disbursal: the borrower now owes the organization. */
export const LOAN_RECEIVABLE_ACCOUNT_CODE = '1100';

/** Asset. Credited when funds leave a bank account. */
export const BANK_ACCOUNT_CODE = '1200';

/** Asset. Credited when funds leave the branch cash drawer. */
export const CASH_ACCOUNT_CODE = '1210';

/**
 * Asset. Debited when a field agent takes cash from a borrower; credited when
 * they hand it to their branch.
 *
 * # Why a field collection does not debit `1210`
 *
 * `1210 Cash in Hand` is the branch drawer. Cash an agent is carrying is not in
 * it — it is in a person's pocket, possibly for hours, possibly overnight.
 * Debiting `1210` at the moment of collection would assert the branch holds
 * money it has never seen, and the shortfall would be invisible until someone
 * counted the drawer. Rule 18 names a distinct Field Agent Cash-in-Hand account
 * for exactly this, and Rule 20 makes the handover the transfer between the two.
 *
 * # Why one control account rather than one per agent
 *
 * The same reason this file's header gives for accounts not being branch-scoped:
 * *which* agent holds the cash is carried by `AccountDimension.userId` on the
 * journal line, not by owning a separate account per person. A per-agent chart
 * would grow a row on every hire, make a consolidated trial balance a join
 * rather than a sum, and leave the ledger holding stale accounts for people who
 * have left.
 *
 * `isControlAccount: true` and `isManualPostingAllowed: false` follow `1100`'s
 * precedent exactly: the balance is driven by a subsidiary ledger — here, the
 * collections and handovers of Module 12 — and a hand-authored journal against
 * it would put the control total and the subsidiary detail out of step with
 * nothing to detect the drift.
 */
export const FIELD_AGENT_CASH_ACCOUNT_CODE = '1220';

/**
 * Income. Credited when a repayment's interest portion is collected.
 *
 * Interest is recognised here rather than retired from a receivable because no
 * interest receivable was ever raised — see the file header.
 */
export const INTEREST_INCOME_ACCOUNT_CODE = '4100';

/** Income. Credited when a repayment's penalty portion is collected. */
export const PENALTY_INCOME_ACCOUNT_CODE = '4200';

/**
 * Income. Credited when a repayment's fee portion is collected.
 *
 * No module raises a fee yet, so this account exists and is posted to by a code
 * path that is currently never reached with a non-zero amount. It is seeded
 * anyway so that adding fees later is a service change, not a migration.
 */
export const FEE_INCOME_ACCOUNT_CODE = '4300';

/**
 * Expense. Debited when a loan is written off or a settlement forgives part of
 * a balance (Module 13).
 *
 * The first expense account in this chart: Modules 09-14 needed only assets and
 * income, and a write-off is the first event that recognises a loss.
 *
 * # Why a write-off is an expense rather than a reversal of income
 *
 * A write-off posts `Dr 5100 / Cr 1100 Loan Receivable`: the asset raised at
 * disbursal is retired because it will not be collected, and the shortfall is
 * recognised as a loss. It deliberately does **not** reverse the interest
 * recognised on earlier collections — that interest was genuinely earned and
 * received, and unwinding it would misstate every prior period to make the
 * current one look tidier.
 *
 * # Why it is not a control account
 *
 * Unlike `1100` and `1220`, its balance is not the summary of a subsidiary
 * ledger — nothing reconciles against it row by row — so a hand-authored
 * journal against it cannot desynchronise anything. An accountant writing off a
 * non-loan receivable is a legitimate entry, which is why manual posting is
 * allowed here and refused there.
 */
export const WRITE_OFF_EXPENSE_ACCOUNT_CODE = '5100';

export interface LedgerAccountSpec {
  accountCode: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';

  /**
   * Whether a hand-authored Module 14 journal may reference this account.
   *
   * Carried here rather than left to the column default because the seed
   * creates these rows for every new organization. Relying on the default
   * (`false`) would give a freshly seeded org a chart with nothing an operator
   * could manually post to, and the journal builder's account picker would be
   * empty. The Module 14 migration sets the same values for organizations that
   * already existed; the two must agree.
   */
  isManualPostingAllowed: boolean;

  /**
   * A control account whose balance is driven by a subsidiary ledger rather
   * than by hand.
   */
  isControlAccount: boolean;
}

/**
 * Every account the seed creates, per organization.
 *
 * The first three are assets with a DEBIT normal balance. That is not a
 * copy-paste slip: a disbursal moves value between two asset accounts — cash or
 * bank decreases, loans receivable increases — so both sides are naturally
 * debit accounts and the credit is what reduces one of them.
 *
 * The last three are income with a CREDIT normal balance, added by Module 11.
 * A collection debits cash or bank (an asset rising), credits Loan Receivable
 * for the principal (the asset falling as the debt is retired) and credits
 * these for the rest (income earned).
 */
export const LEDGER_ACCOUNT_SPECS: readonly LedgerAccountSpec[] = [
  {
    accountCode: LOAN_RECEIVABLE_ACCOUNT_CODE,
    accountName: 'Loan Receivable',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    isManualPostingAllowed: false,
    isControlAccount: true,
  },
  {
    accountCode: BANK_ACCOUNT_CODE,
    accountName: 'Bank Account',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    isManualPostingAllowed: true,
    isControlAccount: false,
  },
  {
    accountCode: CASH_ACCOUNT_CODE,
    accountName: 'Cash in Hand',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    isManualPostingAllowed: true,
    isControlAccount: false,
  },
  {
    accountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
    accountName: 'Field Agent Cash in Hand',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    // A control account driven by Module 12's collections and handovers. Hand
    // posting to it would desynchronise the control total from the custody
    // detail, with nothing to notice the drift.
    isManualPostingAllowed: false,
    isControlAccount: true,
  },
  {
    accountCode: INTEREST_INCOME_ACCOUNT_CODE,
    accountName: 'Interest Income',
    accountType: 'INCOME',
    normalBalance: 'CREDIT',
    isManualPostingAllowed: true,
    isControlAccount: false,
  },
  {
    accountCode: PENALTY_INCOME_ACCOUNT_CODE,
    accountName: 'Penalty Income',
    accountType: 'INCOME',
    normalBalance: 'CREDIT',
    isManualPostingAllowed: true,
    isControlAccount: false,
  },
  {
    accountCode: FEE_INCOME_ACCOUNT_CODE,
    accountName: 'Fee Income',
    accountType: 'INCOME',
    normalBalance: 'CREDIT',
    isManualPostingAllowed: true,
    isControlAccount: false,
  },
  {
    // Module 13. An expense with a DEBIT normal balance — the first of its kind
    // here, and not a copy-paste slip: an expense rises by being debited, the
    // same direction as an asset, which is why a write-off can debit this and
    // credit Loan Receivable and still balance.
    accountCode: WRITE_OFF_EXPENSE_ACCOUNT_CODE,
    accountName: 'Loan Write-off Expense',
    accountType: 'EXPENSE',
    normalBalance: 'DEBIT',
    isManualPostingAllowed: true,
    isControlAccount: false,
  },
] as const;

/**
 * Which income account each allocated component is recognised in.
 *
 * PRINCIPAL is absent deliberately: it is not income. A principal repayment
 * retires the receivable raised at disbursal, so it credits
 * `LOAN_RECEIVABLE_ACCOUNT_CODE` instead — the one case where the credit side
 * of a collection is an asset rather than income. `LedgerService.postCollection`
 * handles it separately for exactly that reason.
 */
export const COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT: Readonly<
  Record<'INTEREST' | 'PENALTY' | 'FEE', string>
> = {
  INTEREST: INTEREST_INCOME_ACCOUNT_CODE,
  PENALTY: PENALTY_INCOME_ACCOUNT_CODE,
  FEE: FEE_INCOME_ACCOUNT_CODE,
};

/**
 * The funding account a payment mode draws from — the credit side of a
 * disbursal.
 *
 * UPI settles through a bank account, not the cash drawer, so it maps with
 * BANK_TRANSFER. The source names only "Bank / Cash" as transfer methods
 * (Rule 10); `PaymentMode` carries UPI because Module 13 collects through it,
 * and leaving it unmapped here would be a runtime hole the type system could
 * not see.
 */
export const FUNDING_ACCOUNT_BY_PAYMENT_MODE: Readonly<
  Record<PaymentMode, string>
> = {
  CASH: CASH_ACCOUNT_CODE,
  UPI: BANK_ACCOUNT_CODE,
  BANK_TRANSFER: BANK_ACCOUNT_CODE,
};

/**
 * The accounts an operator may pick as the source of funds.
 *
 * Loan receivable is absent deliberately: it is the debit side of every
 * disbursal, chosen by the posting rule rather than by a person, and offering
 * it in the form would let a disbursal be scheduled against the account it is
 * supposed to increase.
 */
export const FUNDING_ACCOUNT_CODES: readonly string[] = [
  BANK_ACCOUNT_CODE,
  CASH_ACCOUNT_CODE,
];
