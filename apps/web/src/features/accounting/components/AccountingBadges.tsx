import type { JournalEntryStatus } from "@lms/types";
import { Badge } from "@lms/ui";

/**
 * Status and classification pills for the accounting surface.
 *
 * The labels come from the same wording the option registries in
 * `@lms/validation` use, so a badge and a dropdown never disagree about what a
 * value is called — the drift that made the same loan status read "more info
 * required" in one place and "More info needed" in another.
 */

export function JournalStatusBadge({ status }: { status: JournalEntryStatus }) {
  const variant =
    status === "POSTED"
      ? "success"
      : status === "REVERSED"
        ? "warning"
        : "light";

  const label =
    status === "POSTED"
      ? "Posted"
      : status === "REVERSED"
        ? "Reversed"
        : "Draft";

  return (
    <Badge size="sm" color={variant}>
      {label}
    </Badge>
  );
}

export function AccountStatusBadge({
  status,
}: {
  status: "ACTIVE" | "INACTIVE";
}) {
  return (
    <Badge size="sm" color={status === "ACTIVE" ? "success" : "light"}>
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </Badge>
  );
}

/**
 * Shown only when an entry does not balance.
 *
 * A posted entry always balances — the database refuses anything else — so this
 * appears on drafts, where it is the operator's cue that there is work left. A
 * green "Balanced" badge on every posted row would be noise reporting a fact
 * that cannot be otherwise.
 */
export function BalanceBadge({ balanced }: { balanced: boolean }) {
  if (balanced) return null;

  return (
    <Badge size="sm" color="warning">
      Out of balance
    </Badge>
  );
}

/**
 * Marks an account a hand-written journal may not touch.
 *
 * A control account is driven by its subsidiary ledger — 1100 Loan Receivable
 * is moved by disbursals and repayments — so posting to it by hand would
 * desynchronise the ledger from the loan book.
 */
export function ControlAccountBadge({ control }: { control: boolean }) {
  if (!control) return null;

  return (
    <Badge size="sm" color="info">
      Control
    </Badge>
  );
}

export function accountTypeLabel(accountType: string): string {
  const labels: Record<string, string> = {
    ASSET: "Asset",
    LIABILITY: "Liability",
    EQUITY: "Equity",
    INCOME: "Income",
    EXPENSE: "Expense",
  };

  return labels[accountType] ?? accountType;
}

export function normalBalanceLabel(normalBalance: string): string {
  return normalBalance === "DEBIT" ? "Debit" : "Credit";
}

/**
 * The human name for an entry type.
 *
 * Covers all fifteen because the journal list shows source-posted entries
 * alongside hand-authored ones — a finance user looking for yesterday's
 * disbursals is the ordinary case.
 */
export function entryTypeLabel(entryType: string): string {
  const labels: Record<string, string> = {
    DISBURSEMENT: "Disbursement",
    COLLECTION: "Collection",
    INTEREST_ACCRUAL: "Interest accrual",
    PENALTY_ASSESSMENT: "Penalty assessment",
    PENALTY_ADJUSTMENT: "Penalty adjustment",
    PENALTY_WAIVER: "Penalty waiver",
    PENALTY_CANCELLATION: "Penalty cancellation",
    FEE: "Fee",
    EXPENSE: "Expense",
    SETTLEMENT: "Settlement",
    WRITE_OFF: "Write-off",
    LOAN_CLOSURE: "Loan closure",
    REVERSAL: "Reversal",
    MANUAL: "Manual journal",
    ADJUSTMENT: "Adjustment",
  };

  return labels[entryType] ?? entryType;
}
