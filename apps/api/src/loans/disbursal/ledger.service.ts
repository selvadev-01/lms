import { ConflictException, Injectable } from '@nestjs/common';
import type {
  LedgerEntryDetail,
  LedgerLineView,
  PaymentMode,
} from '@lms/types';

import { nextEntryNumber } from '../../accounting/accounting-numbering';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../applications/application-transition.service';
import {
  CASH_ACCOUNT_CODE,
  COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT,
  FIELD_AGENT_CASH_ACCOUNT_CODE,
  FUNDING_ACCOUNT_BY_PAYMENT_MODE,
  LOAN_RECEIVABLE_ACCOUNT_CODE,
  WRITE_OFF_EXPENSE_ACCOUNT_CODE,
} from './ledger-accounts';

/**
 * The allocated components of a collection, in appropriation order.
 *
 * Mirrors `AllocationResult`'s totals rather than importing it, so the ledger
 * depends on the shape of a posting and not on the allocator that produced it.
 */
export interface CollectionComponents {
  penaltyPaise: bigint;
  interestPaise: bigint;
  principalPaise: bigint;
  feesPaise: bigint;
}

/** One side of a collection entry, before line numbers are assigned. */
interface PendingLine {
  accountCode: string;
  amountPaise: bigint;
  description: string;
  /**
   * Which part of the source transaction this line represents.
   *
   * Recorded so reconciliation can trace a source transaction to its journal at
   * line granularity rather than entry granularity — answering "which line is
   * the interest" without re-deriving it from the account code, which would
   * break the moment the chart gains a second interest account.
   */
  sourceComponent: string;
  /**
   * The user this line's dimension is attributed to (Module 12).
   *
   * Set on the cash line of a field collection and on the agent side of a cash
   * handover, so an agent-scoped balance of account 1220 is a sum over
   * dimensions rather than a join through collections.
   *
   * Per-line rather than per-entry deliberately. Tagging every line of a field
   * collection with the agent would make an agent-scoped trial balance claim
   * the agent personally holds interest income — the agent holds the *cash*,
   * and only that line is theirs.
   */
  dimensionUserId?: string;
}

/**
 * The only writer of journal rows in the codebase.
 *
 * # Scope
 *
 * Deliberately tiny. Module 14 (Accounting & Ledger) owns the general ledger —
 * the chart of accounts and its CRUD, reversals, trial balance, period close.
 * This exists so that Modules 09, 11 and 12 can post a balanced entry without
 * inlining SQL in their services, and so the one place that writes
 * `journal_lines` has the balance assertion in it.
 *
 * Module 12's two additions — `postCashHandover` and its reversal — live here
 * rather than in the cash service for exactly that reason: a second writer of
 * journal rows is how the balance assertion ends up applying to some entries
 * and not others.
 *
 * # Two guarantees, deliberately duplicated
 *
 * The debit-equals-credit check appears twice: here in TypeScript, and again in
 * the `journal_lines_balanced` deferred constraint trigger installed by the
 * disbursal migration. That is not redundancy to delete.
 *
 * The trigger is the guarantee — it holds against a future module, a migration
 * and a psql session alike, and it is what makes Rule 13 true rather than
 * merely intended. But a trigger raises a Postgres exception that surfaces as
 * an opaque failure inside a money-moving transaction. The TypeScript check
 * runs first and produces a message naming the two amounts, so an operator
 * sees why rather than that.
 *
 * If the two ever disagree, the trigger wins and the transaction rolls back.
 * That is the correct outcome.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Posts the double-entry for a disbursal (Scenarios 19, 21).
   *
   * ```
   * Dr  Loan Receivable            amountPaise
   *   Cr  Bank / Cash (by mode)      amountPaise
   * ```
   *
   * Two lines, one entry, net zero. Both accounts are assets: a disbursal moves
   * value between them — the borrower's debt rises as the funding account falls
   * — so the credit is what reduces one, not a liability being incurred.
   *
   * Returns the new entry's id, which the caller writes back onto the
   * disbursement so a financial record and its posting are mutually reachable
   * (Scenario 49).
   */
  async postDisbursement(
    tx: TransitionTx,
    input: {
      orgId: string;
      loanId: string;
      branchId: string;
      customerId: string;
      amountPaise: bigint;
      paymentMode: PaymentMode;
      entryDate: Date;
      disbursementId: string;
      loanNumber: string;
      createdBy: string;
    },
  ): Promise<string> {
    if (input.amountPaise <= 0n) {
      // Rule 19 / Scenario 7. Reached only if a caller skipped its own check;
      // a zero-amount entry would balance trivially and post nothing real.
      throw new ConflictException(
        'A disbursement amount must be greater than zero',
      );
    }

    const debitAccount = await this.requireActiveAccount(
      tx,
      input.orgId,
      LOAN_RECEIVABLE_ACCOUNT_CODE,
    );

    const creditAccount = await this.requireActiveAccount(
      tx,
      input.orgId,
      FUNDING_ACCOUNT_BY_PAYMENT_MODE[input.paymentMode],
    );

    const entryNumber = await this.nextEntryNumber(tx, input.orgId);

    const entry = await tx.journalEntry.create({
      data: {
        orgId: input.orgId,
        entryNumber,
        entryDate: input.entryDate,
        postedAt: new Date(),
        entryType: 'DISBURSEMENT',
        status: 'POSTED',
        // The seam that makes an entry traceable back to what caused it
        // (Scenario 49). Indexed as `[orgId, sourceType, sourceId]`.
        sourceType: 'DISBURSEMENT',
        sourceId: input.disbursementId,
        description: `Disbursement of loan ${input.loanNumber}`,
        createdBy: input.createdBy,
        // Module 14. Both were implicit before it: a source posting is always
        // posted by whoever created it, and its branch could only be recovered
        // by joining through the dimension rows. Recording them on the entry is
        // what lets the general ledger confine by branch with a `where` clause,
        // and what lets the DRAFT -> POSTED trigger insist a posted entry names
        // its actor.
        postedBy: input.createdBy,
        branchId: input.branchId,
      },
    });

    // The analytical slice. Which branch and loan a posting belongs to lives
    // here rather than in a per-branch account, which is what keeps a
    // consolidated trial balance a sum rather than a join.
    const dimension = async (accountId: string) =>
      (
        await tx.accountDimension.create({
          data: {
            orgId: input.orgId,
            accountId,
            branchId: input.branchId,
            loanId: input.loanId,
            customerId: input.customerId,
          },
        })
      ).dimensionId;

    await tx.journalLine.create({
      data: {
        orgId: input.orgId,
        journalEntryId: entry.journalEntryId,
        lineNumber: 1,
        accountId: debitAccount.accountId,
        dimensionId: await dimension(debitAccount.accountId),
        debitPaise: input.amountPaise,
        creditPaise: 0n,
        description: `Loan receivable — ${input.loanNumber}`,
        sourceComponent: 'PRINCIPAL',
      },
    });

    await tx.journalLine.create({
      data: {
        orgId: input.orgId,
        journalEntryId: entry.journalEntryId,
        lineNumber: 2,
        accountId: creditAccount.accountId,
        dimensionId: await dimension(creditAccount.accountId),
        debitPaise: 0n,
        creditPaise: input.amountPaise,
        description: `Funds disbursed via ${input.paymentMode}`,
        sourceComponent: 'FUNDING',
      },
    });

    // The readable half of the balance check. The deferred trigger will assert
    // the same thing at COMMIT; this exists so a mismatch is legible.
    await this.assertBalanced(tx, input.orgId, entry.journalEntryId);

    return entry.journalEntryId;
  }

  /**
   * Posts the double-entry for a collection (Module 11 Scenarios 19, 20).
   *
   * ```
   * Dr  Cash / Bank (by mode)      collectedAmount
   *   Cr  Penalty Income             penaltyPaise     (omitted when zero)
   *   Cr  Interest Income            interestPaise    (omitted when zero)
   *   Cr  Loan Receivable            principalPaise   (omitted when zero)
   *   Cr  Fee Income                 feesPaise        (omitted when zero)
   * ```
   *
   * # Why only the principal touches Loan Receivable
   *
   * `postDisbursement` debited that account for the sanctioned principal alone;
   * interest was never raised as a receivable. A repayment therefore retires
   * the asset only to the extent of its principal portion, and the rest is
   * income recognised on collection. Crediting an "interest receivable" — which
   * is what the source's wording literally asks for — would drive an account
   * that never had a balance increasingly negative. See `ledger-accounts.ts`.
   *
   * # Why zero components are omitted rather than posted as zero lines
   *
   * A line that moves nothing is not a fact. Omitting them keeps `lineNumber`
   * contiguous over the lines that exist, and keeps the ledger panel readable.
   * The order is fixed regardless of which lines survive, so the same
   * allocation always produces the same entry (Scenario 8 extends to the
   * ledger).
   *
   * Returns the new entry's id, which the caller writes back onto the
   * collection so a receipt and its posting are mutually reachable.
   */
  async postCollection(
    tx: TransitionTx,
    input: {
      orgId: string;
      loanId: string;
      branchId: string;
      customerId: string;
      collectionId: string;
      receiptNumber: string;
      loanNumber: string;
      paymentMode: PaymentMode;
      entryDate: Date;
      createdBy: string;
      components: CollectionComponents;
      /**
       * Where the cash landed, when it is not the branch drawer (Module 12).
       *
       * A field agent's collection debits `1220 Field Agent Cash in Hand`
       * rather than `1210`, because the money is in a person's pocket and may
       * be for hours. Omitted by every Module 11 caller, which keeps the
       * default behaviour byte-identical to before this parameter existed.
       */
      cashAccountCode?: string;
      /** The agent whose custody the cash entered. Tags the cash line only. */
      agentUserId?: string;
    },
  ): Promise<string> {
    const total = this.totalOf(input.components);

    if (total <= 0n) {
      // Reached only if a caller skipped its own check. A zero entry would
      // balance trivially and record nothing real.
      throw new ConflictException(
        'A collection amount must be greater than zero',
      );
    }

    const { components } = input;

    const credits: PendingLine[] = [
      {
        accountCode: COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT.PENALTY,
        amountPaise: components.penaltyPaise,
        description: `Penalty collected — ${input.loanNumber}`,
        sourceComponent: 'PENALTY',
      },
      {
        accountCode: COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT.INTEREST,
        amountPaise: components.interestPaise,
        description: `Interest collected — ${input.loanNumber}`,
        sourceComponent: 'INTEREST',
      },
      {
        accountCode: LOAN_RECEIVABLE_ACCOUNT_CODE,
        amountPaise: components.principalPaise,
        description: `Principal repaid — ${input.loanNumber}`,
        sourceComponent: 'PRINCIPAL',
      },
      {
        accountCode: COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT.FEE,
        amountPaise: components.feesPaise,
        description: `Fees collected — ${input.loanNumber}`,
        sourceComponent: 'FEE',
      },
    ].filter((line) => line.amountPaise > 0n);

    const debit: PendingLine = {
      accountCode:
        input.cashAccountCode ??
        FUNDING_ACCOUNT_BY_PAYMENT_MODE[input.paymentMode],
      amountPaise: total,
      description: `Receipt ${input.receiptNumber} via ${input.paymentMode}`,
      sourceComponent: 'FUNDING',
      dimensionUserId: input.agentUserId,
    };

    return this.writeEntry(tx, {
      orgId: input.orgId,
      loanId: input.loanId,
      branchId: input.branchId,
      customerId: input.customerId,
      entryDate: input.entryDate,
      entryType: 'COLLECTION',
      sourceType: 'COLLECTION',
      sourceId: input.collectionId,
      description: `Collection ${input.receiptNumber} — loan ${input.loanNumber}`,
      createdBy: input.createdBy,
      debits: [debit],
      credits,
    });
  }

  /**
   * Posts the opposite entry for a reversed collection (Scenario 32).
   *
   * Every line of `postCollection`, with debit and credit exchanged. The
   * original entry's lines are never touched — `journal_lines_append_only`
   * would refuse anyway — which is what "the original journal remains
   * unchanged" actually means. The caller separately flips the original entry's
   * status to REVERSED, the one mutation the append-only trigger permits.
   */
  async postCollectionReversal(
    tx: TransitionTx,
    input: {
      orgId: string;
      loanId: string;
      branchId: string;
      customerId: string;
      /** The reversal row, not the collection being reversed. */
      reversalCollectionId: string;
      originalReceiptNumber: string;
      loanNumber: string;
      paymentMode: PaymentMode;
      entryDate: Date;
      createdBy: string;
      reversalReason: string;
      components: CollectionComponents;
      /**
       * The cash account the original posting debited (Module 12).
       *
       * Passed through so a reversal credits back the account the money
       * actually went to. Reversing a field collection against `1210` would
       * take the cash out of the branch drawer it never entered and leave 1220
       * permanently overstated — which is exactly the inconsistent balance
       * Scenario 41 forbids.
       */
      cashAccountCode?: string;
      agentUserId?: string;
    },
  ): Promise<string> {
    const total = this.totalOf(input.components);

    if (total <= 0n) {
      throw new ConflictException(
        'A reversal amount must be greater than zero',
      );
    }

    const { components } = input;

    const debits: PendingLine[] = [
      {
        accountCode: COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT.PENALTY,
        amountPaise: components.penaltyPaise,
        description: `Penalty reversed — ${input.loanNumber}`,
        sourceComponent: 'PENALTY',
      },
      {
        accountCode: COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT.INTEREST,
        amountPaise: components.interestPaise,
        description: `Interest reversed — ${input.loanNumber}`,
        sourceComponent: 'INTEREST',
      },
      {
        accountCode: LOAN_RECEIVABLE_ACCOUNT_CODE,
        amountPaise: components.principalPaise,
        description: `Principal repayment reversed — ${input.loanNumber}`,
        sourceComponent: 'PRINCIPAL',
      },
      {
        accountCode: COLLECTION_CREDIT_ACCOUNT_BY_COMPONENT.FEE,
        amountPaise: components.feesPaise,
        description: `Fees reversed — ${input.loanNumber}`,
        sourceComponent: 'FEE',
      },
    ].filter((line) => line.amountPaise > 0n);

    const credit: PendingLine = {
      accountCode:
        input.cashAccountCode ??
        FUNDING_ACCOUNT_BY_PAYMENT_MODE[input.paymentMode],
      amountPaise: total,
      description: `Reversal of receipt ${input.originalReceiptNumber}`,
      sourceComponent: 'FUNDING',
      dimensionUserId: input.agentUserId,
    };

    return this.writeEntry(tx, {
      orgId: input.orgId,
      loanId: input.loanId,
      branchId: input.branchId,
      customerId: input.customerId,
      entryDate: input.entryDate,
      entryType: 'REVERSAL',
      sourceType: 'COLLECTION_REVERSAL',
      sourceId: input.reversalCollectionId,
      description: `Reversal of collection ${input.originalReceiptNumber} — ${input.reversalReason}`,
      createdBy: input.createdBy,
      debits,
      credits: [credit],
    });
  }

  /**
   * Posts the custody transfer when a branch receives an agent's cash
   * (Module 12, Scenario 23).
   *
   * ```
   * Dr  Branch Cash in Hand          receivedPaise
   *   Cr  Field Agent Cash in Hand     receivedPaise
   * ```
   *
   * # What this entry is not
   *
   * It is **not a second customer repayment** (Rule 21). The borrower paid when
   * the agent took the money, and that posting already credited their
   * receivables. This moves the same rupees between two asset accounts: out of
   * the agent's custody, into the branch's. Two lines, both assets, net zero.
   *
   * Hence no `loanId` and no `customerId` on the entry (Rule 22) — a custody
   * transfer belongs to no borrower, and tagging it to one would make it appear
   * in that loan's ledger as though the customer had paid twice.
   *
   * The credit line carries the agent in its dimension and the debit line does
   * not: branch cash is nobody's personally, and attributing it to the agent
   * would leave their dimension-scoped balance netting to zero the moment they
   * handed the money over — the opposite of what it should show.
   *
   * Returns the new entry's id, which the caller writes onto the handover row.
   */
  async postCashHandover(
    tx: TransitionTx,
    input: {
      orgId: string;
      branchId: string;
      fieldAgentId: string;
      handoverId: string;
      handoverNumber: string;
      agentName: string;
      amountPaise: bigint;
      entryDate: Date;
      createdBy: string;
    },
  ): Promise<string> {
    if (input.amountPaise <= 0n) {
      throw new ConflictException(
        'A cash handover amount must be greater than zero',
      );
    }

    return this.writeEntry(tx, {
      orgId: input.orgId,
      branchId: input.branchId,
      entryDate: input.entryDate,
      entryType: 'TRANSFER',
      sourceType: 'CASH_HANDOVER',
      sourceId: input.handoverId,
      description: `Cash handover ${input.handoverNumber} from ${input.agentName}`,
      createdBy: input.createdBy,
      debits: [
        {
          accountCode: CASH_ACCOUNT_CODE,
          amountPaise: input.amountPaise,
          description: `Cash received — handover ${input.handoverNumber}`,
          sourceComponent: 'CASH_RECEIVED',
        },
      ],
      credits: [
        {
          accountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
          amountPaise: input.amountPaise,
          description: `Agent cash released — ${input.agentName}`,
          sourceComponent: 'AGENT_CASH',
          dimensionUserId: input.fieldAgentId,
        },
      ],
    });
  }

  /**
   * Posts the opposite entry for a reversed cash handover (Module 12).
   *
   * `postCashHandover` with the sides exchanged: the cash goes back out of the
   * branch drawer and into the agent's custody. The original entry's lines are
   * never touched — `journal_lines_append_only` would refuse — and the caller
   * separately flips the original entry's status to REVERSED and releases the
   * claim on the underlying collections, so the agent's derived balance returns
   * to what it was.
   */
  async postCashHandoverReversal(
    tx: TransitionTx,
    input: {
      orgId: string;
      branchId: string;
      fieldAgentId: string;
      /** The reversal row, not the handover being reversed. */
      reversalHandoverId: string;
      originalHandoverNumber: string;
      agentName: string;
      amountPaise: bigint;
      entryDate: Date;
      createdBy: string;
      reversalReason: string;
    },
  ): Promise<string> {
    if (input.amountPaise <= 0n) {
      throw new ConflictException(
        'A reversal amount must be greater than zero',
      );
    }

    return this.writeEntry(tx, {
      orgId: input.orgId,
      branchId: input.branchId,
      entryDate: input.entryDate,
      entryType: 'REVERSAL',
      sourceType: 'CASH_HANDOVER_REVERSAL',
      sourceId: input.reversalHandoverId,
      description: `Reversal of cash handover ${input.originalHandoverNumber} — ${input.reversalReason}`,
      createdBy: input.createdBy,
      debits: [
        {
          accountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
          amountPaise: input.amountPaise,
          description: `Agent cash restored — ${input.agentName}`,
          sourceComponent: 'AGENT_CASH',
          dimensionUserId: input.fieldAgentId,
        },
      ],
      credits: [
        {
          accountCode: CASH_ACCOUNT_CODE,
          amountPaise: input.amountPaise,
          description: `Cash returned — handover ${input.originalHandoverNumber}`,
          sourceComponent: 'CASH_RECEIVED',
        },
      ],
    });
  }

  private totalOf(components: CollectionComponents): bigint {
    return (
      components.penaltyPaise +
      components.interestPaise +
      components.principalPaise +
      components.feesPaise
    );
  }

  /**
   * Posts the loss when a loan is written off or a settlement forgives part of
   * a balance (Module 13).
   *
   * `Dr 5100 Loan Write-off Expense / Cr 1100 Loan Receivable`: the asset
   * raised at disbursal is retired because it will not be collected, and the
   * shortfall is recognised as a loss.
   *
   * # Why it does not reverse the interest already recognised
   *
   * A repayment on this loan credited `4100 Interest Income` at the moment it
   * was collected, and that interest was genuinely earned and received.
   * Unwinding it here would misstate every prior period to make the current one
   * look tidier. Only the *unrecovered* asset is written off.
   *
   * # Why the amount is principal, not the total overdue
   *
   * `1100` holds principal alone — interest was never raised as a receivable
   * (see `ledger-accounts.ts`). Crediting it for the whole overdue figure would
   * drive the account below the principal actually outstanding and leave the
   * control total disagreeing with the loan book. The caller passes the
   * principal it is abandoning.
   */
  async postWriteOff(
    tx: TransitionTx,
    input: {
      orgId: string;
      loanId: string;
      branchId: string;
      customerId: string;
      loanNumber: string;
      /** The row this posting belongs to: a settlement, or the loan itself. */
      sourceType: 'SETTLEMENT' | 'LOAN_WRITE_OFF';
      sourceId: string;
      /** Unrecovered **principal**. See the note above. */
      principalPaise: bigint;
      entryDate: Date;
      createdBy: string;
      reason: string;
    },
  ): Promise<string> {
    if (input.principalPaise <= 0n) {
      // Reached only if a caller skipped its own check. A zero entry would
      // balance trivially and record nothing real.
      throw new ConflictException(
        'A write-off amount must be greater than zero',
      );
    }

    return this.writeEntry(tx, {
      orgId: input.orgId,
      loanId: input.loanId,
      branchId: input.branchId,
      customerId: input.customerId,
      entryDate: input.entryDate,
      entryType: input.sourceType === 'SETTLEMENT' ? 'SETTLEMENT' : 'WRITE_OFF',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      description: `${
        input.sourceType === 'SETTLEMENT' ? 'Settlement waiver' : 'Write-off'
      } — loan ${input.loanNumber}: ${input.reason}`,
      createdBy: input.createdBy,
      debits: [
        {
          accountCode: WRITE_OFF_EXPENSE_ACCOUNT_CODE,
          amountPaise: input.principalPaise,
          description: `Loss recognised — loan ${input.loanNumber}`,
          sourceComponent: 'WRITE_OFF',
        },
      ],
      credits: [
        {
          accountCode: LOAN_RECEIVABLE_ACCOUNT_CODE,
          amountPaise: input.principalPaise,
          description: `Receivable retired — loan ${input.loanNumber}`,
          sourceComponent: 'PRINCIPAL',
        },
      ],
    });
  }

  /**
   * Writes one balanced entry from a set of debit and credit lines.
   *
   * Shared by both collection paths because a reversal is the same entry with
   * the sides exchanged, and two near-identical copies of ledger-writing code
   * is how the two drift into disagreeing about line ordering or dimensions.
   *
   * Line numbers are assigned debits-then-credits over the lines that survived
   * the zero filter, so they stay contiguous and the ordering is a function of
   * the allocation alone.
   */
  private async writeEntry(
    tx: TransitionTx,
    input: {
      orgId: string;
      /**
       * Absent on a cash handover (Module 12): a custody transfer belongs to no
       * loan and no borrower, and tagging one to a loan would surface it in that
       * borrower's ledger (Rules 21, 22).
       */
      loanId?: string;
      branchId: string;
      customerId?: string;
      entryDate: Date;
      /**
       * Narrowed to the types this service actually posts, rather than the
       * whole `JournalEntryType` enum. A caller that mistyped an entry as
       * `MANUAL` would produce a posting the accounting module's own workflow
       * believes it owns; keeping the union small is what makes that a compile
       * error. Module 13 adds `SETTLEMENT` and `WRITE_OFF`.
       */
      entryType:
        'COLLECTION' | 'REVERSAL' | 'TRANSFER' | 'SETTLEMENT' | 'WRITE_OFF';
      sourceType: string;
      sourceId: string;
      description: string;
      createdBy: string;
      debits: PendingLine[];
      credits: PendingLine[];
    },
  ): Promise<string> {
    // Resolved before anything is written: an inactive income account must stop
    // the posting before a half-built entry exists, not after.
    const accountIds = new Map<string, string>();
    for (const line of [...input.debits, ...input.credits]) {
      if (accountIds.has(line.accountCode)) continue;
      const account = await this.requireActiveAccount(
        tx,
        input.orgId,
        line.accountCode,
      );
      accountIds.set(line.accountCode, account.accountId);
    }

    const entryNumber = await this.nextEntryNumber(tx, input.orgId);

    const entry = await tx.journalEntry.create({
      data: {
        orgId: input.orgId,
        entryNumber,
        entryDate: input.entryDate,
        postedAt: new Date(),
        entryType: input.entryType,
        status: 'POSTED',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        description: input.description,
        createdBy: input.createdBy,
        // Module 14. See the matching note in `postDisbursement`.
        postedBy: input.createdBy,
        branchId: input.branchId,
      },
    });

    let lineNumber = 0;

    const write = async (line: PendingLine, side: 'debit' | 'credit') => {
      lineNumber += 1;
      const accountId = accountIds.get(line.accountCode)!;
      const dimension = await tx.accountDimension.create({
        data: {
          orgId: input.orgId,
          accountId,
          branchId: input.branchId,
          loanId: input.loanId ?? null,
          customerId: input.customerId ?? null,
          // Module 12. Null on every line that is not an agent's cash, which is
          // every line of every entry the other modules write.
          userId: line.dimensionUserId ?? null,
        },
      });

      await tx.journalLine.create({
        data: {
          orgId: input.orgId,
          journalEntryId: entry.journalEntryId,
          lineNumber,
          accountId,
          dimensionId: dimension.dimensionId,
          debitPaise: side === 'debit' ? line.amountPaise : 0n,
          creditPaise: side === 'credit' ? line.amountPaise : 0n,
          description: line.description,
          sourceComponent: line.sourceComponent,
        },
      });
    };

    for (const line of input.debits) await write(line, 'debit');
    for (const line of input.credits) await write(line, 'credit');

    await this.assertBalanced(tx, input.orgId, entry.journalEntryId);

    return entry.journalEntryId;
  }

  /**
   * The posted entry behind a disbursement, for the ledger panel.
   *
   * Totals are computed here rather than left to the client so the UI's balance
   * assertion (Scenario 19) reads the same numbers the database enforced.
   */
  async getEntry(
    orgId: string,
    journalEntryId: string,
  ): Promise<LedgerEntryDetail | null> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { orgId, journalEntryId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { account: true },
        },
      },
    });

    if (!entry) return null;

    const lines: LedgerLineView[] = entry.lines.map((line) => ({
      lineNumber: line.lineNumber,
      accountCode: line.account.accountCode,
      accountName: line.account.accountName,
      debitPaise: line.debitPaise.toString(),
      creditPaise: line.creditPaise.toString(),
      ...(line.description ? { description: line.description } : {}),
    }));

    const totalDebit = entry.lines.reduce((sum, l) => sum + l.debitPaise, 0n);
    const totalCredit = entry.lines.reduce((sum, l) => sum + l.creditPaise, 0n);

    return {
      journalEntryId: entry.journalEntryId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate.toISOString().slice(0, 10),
      // Null for a DRAFT, which Module 14 introduced. Omitted rather than
      // rendered as an empty string so a caller cannot mistake "not yet
      // posted" for "posted at an unknown time".
      ...(entry.postedAt ? { postedAt: entry.postedAt.toISOString() } : {}),
      entryType: entry.entryType,
      status: entry.status,
      ...(entry.description ? { description: entry.description } : {}),
      lines,
      totalDebitPaise: totalDebit.toString(),
      totalCreditPaise: totalCredit.toString(),
      balanced: totalDebit === totalCredit,
    };
  }

  /**
   * Resolves an account by code and refuses an inactive one (Rule 59,
   * Scenarios 34, 36).
   *
   * Reads through `tx` rather than `this.prisma` on purpose: called inside the
   * disbursal transaction, it must see that transaction's view. Reading outside
   * it would let an account deactivated moments earlier still look active.
   */
  private async requireActiveAccount(
    tx: TransitionTx,
    orgId: string,
    accountCode: string,
  ): Promise<{ accountId: string }> {
    const account = await tx.account.findFirst({
      where: { orgId, accountCode },
      select: { accountId: true, accountName: true, status: true },
    });

    if (!account) {
      // A configuration fault, not a user error: the seed creates these three
      // for every organization. Surfaced as a conflict rather than a 500 so the
      // message reaches the operator instead of a stack trace.
      throw new ConflictException(
        `Ledger account ${accountCode} is not configured for this organization. The posting cannot proceed.`,
      );
    }

    if (account.status !== 'ACTIVE') {
      throw new ConflictException(
        `The ${account.accountName} account is inactive and cannot be posted to`,
      );
    }

    return { accountId: account.accountId };
  }

  /** Rule 13 / Scenario 21, in a form that produces a readable message. */
  private async assertBalanced(
    tx: TransitionTx,
    orgId: string,
    journalEntryId: string,
  ): Promise<void> {
    const lines = await tx.journalLine.findMany({
      where: { orgId, journalEntryId },
      select: { debitPaise: true, creditPaise: true },
    });

    const debit = lines.reduce((sum, l) => sum + l.debitPaise, 0n);
    const credit = lines.reduce((sum, l) => sum + l.creditPaise, 0n);

    if (debit !== credit) {
      throw new ConflictException(
        `The ledger entry does not balance (debit ${debit}, credit ${credit}). No money has moved.`,
      );
    }
  }

  /**
   * Allocates the next journal entry number for the organization.
   *
   * Delegates to `accounting-numbering.ts`, which Module 14's manual-journal
   * posting path also calls. The body moved there rather than being copied: two
   * allocators over one `@@unique([orgId, entryNumber])` index would be two
   * numbering schemes in one ledger, and the second one would only be noticed
   * when it proposed a number the first had already used.
   */
  private async nextEntryNumber(
    tx: Pick<TransitionTx, 'journalEntry'>,
    orgId: string,
  ): Promise<string> {
    return nextEntryNumber(tx, orgId);
  }
}
