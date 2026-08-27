"use client";

import type { AccountSummary, JournalLineInput } from "@lms/types";
import { useMemo, useState } from "react";

import { rupeesToPaise } from "@/features/loans/components/FormParts";
import { formatPaise } from "@/lib/format";

/**
 * The journal line editor.
 *
 * # Money is typed in rupees and submitted in paise
 *
 * The visible fields take rupees because that is the unit an accountant works
 * in; a hidden field beside each carries the converted integer-paise digit
 * string, via the same `rupeesToPaise` every other money form uses — never
 * `value * 100`, which turns 12345.67 into 1234566.9999999999.
 *
 * # Totals are computed with BigInt
 *
 * Never `Number`: a rupee total above about ninety thousand crore loses paise
 * in a double, and a balance indicator that is off by one paise is exactly the
 * bug this module exists to make impossible. `BigInt(0)` is written out rather
 * than `0n` because this app targets ES2017, where the literal is a syntax
 * error.
 *
 * # The balance pill is a hint, not the verdict
 *
 * The authoritative answer comes from `POST /accounting/journals/validate` and
 * from the posting attempt, both of which run against server-held accounts. A
 * green pill here means "this looks postable", not "this will post".
 */

interface Row {
  /**
   * A stable key, not the array index.
   *
   * Removing a row from the middle re-indexes everything below it, and React
   * would then reuse the removed row's DOM node for its successor — silently
   * moving one row's typed-in values onto another.
   */
  key: string;
  accountId: string;
  debitRupees: string;
  creditRupees: string;
  description: string;
}

function blankRow(): Row {
  return {
    key: crypto.randomUUID(),
    accountId: "",
    debitRupees: "",
    creditRupees: "",
    description: "",
  };
}

function rowsFrom(lines: JournalLineInput[] | undefined): Row[] {
  if (!lines || lines.length === 0) return [blankRow(), blankRow()];

  return lines.map((line) => ({
    key: crypto.randomUUID(),
    accountId: line.accountId,
    debitRupees: paiseToRupeeInput(line.debitPaise),
    creditRupees: paiseToRupeeInput(line.creditPaise),
    description: line.description ?? "",
  }));
}

/**
 * Paise back to an editable rupee string.
 *
 * Zero becomes an empty field rather than "0.00": one side of every line is
 * always zero, and showing it as a typed-in amount would suggest the operator
 * had entered one.
 */
function paiseToRupeeInput(paise: string): string {
  if (!/^\d+$/.test(paise) || paise === "0") return "";

  const zero = BigInt(0);
  const hundred = BigInt(100);
  const value = BigInt(paise);
  if (value === zero) return "";

  return `${(value / hundred).toString()}.${(value % hundred).toString().padStart(2, "0")}`;
}

/** A rupee input as integer paise, or "0" when blank or malformed. */
function toPaise(input: string): string {
  if (!input.trim()) return "0";
  return rupeesToPaise(input) || "0";
}

export default function JournalLineBuilder({
  accounts,
  initialLines,
  disabled = false,
}: {
  accounts: AccountSummary[];
  initialLines?: JournalLineInput[];
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(initialLines));

  const totals = useMemo(() => {
    const zero = BigInt(0);
    let debit = zero;
    let credit = zero;

    for (const row of rows) {
      debit += BigInt(toPaise(row.debitRupees));
      credit += BigInt(toPaise(row.creditRupees));
    }

    return { debit, credit, balanced: debit === credit && debit > zero };
  }, [rows]);

  const update = (key: string, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  /**
   * Typing a debit clears that row's credit, and vice versa.
   *
   * This makes a two-sided line unreachable through the form rather than merely
   * refused after submitting it. The DTO and the `journal_lines_shape` database
   * trigger still refuse one, for a client that does not use this form.
   */
  const setDebit = (key: string, value: string) =>
    update(key, { debitRupees: value, creditRupees: "" });

  const setCredit = (key: string, value: string) =>
    update(key, { creditRupees: value, debitRupees: "" });

  const difference = totals.debit - totals.credit;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Debit (₹)</th>
              <th className="px-5 py-3 text-right font-medium">Credit (₹)</th>
              <th className="px-5 py-3 font-medium">Narration</th>
              <th className="px-5 py-3 font-medium">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.key}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
              >
                <td className="px-5 py-3">
                  <select
                    name="lineAccountId"
                    value={row.accountId}
                    disabled={disabled}
                    onChange={(event) =>
                      update(row.key, { accountId: event.target.value })
                    }
                    aria-label={`Account for line ${index + 1}`}
                    className="h-11 w-full min-w-48 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
                  >
                    <option value="">Select account…</option>
                    {accounts.map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.accountCode} — {account.accountName}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-5 py-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.debitRupees}
                    disabled={disabled}
                    onChange={(event) => setDebit(row.key, event.target.value)}
                    aria-label={`Debit for line ${index + 1}`}
                    placeholder="0.00"
                    className="h-11 w-32 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm text-gray-800 tabular-nums dark:border-gray-700 dark:text-white/90"
                  />
                  {/* What actually crosses the wire: integer paise, never a float. */}
                  <input
                    type="hidden"
                    name="lineDebitPaise"
                    value={toPaise(row.debitRupees)}
                  />
                </td>

                <td className="px-5 py-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.creditRupees}
                    disabled={disabled}
                    onChange={(event) => setCredit(row.key, event.target.value)}
                    aria-label={`Credit for line ${index + 1}`}
                    placeholder="0.00"
                    className="h-11 w-32 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm text-gray-800 tabular-nums dark:border-gray-700 dark:text-white/90"
                  />
                  <input
                    type="hidden"
                    name="lineCreditPaise"
                    value={toPaise(row.creditRupees)}
                  />
                </td>

                <td className="px-5 py-3">
                  <input
                    type="text"
                    name="lineDescription"
                    value={row.description}
                    disabled={disabled}
                    maxLength={500}
                    onChange={(event) =>
                      update(row.key, { description: event.target.value })
                    }
                    aria-label={`Narration for line ${index + 1}`}
                    className="h-11 w-full min-w-40 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
                  />
                </td>

                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    // A journal needs a debit and a credit, and one line cannot
                    // be both, so two is the floor. Refusing to go below it is
                    // friendlier than accepting the row and failing on submit.
                    disabled={disabled || rows.length <= 2}
                    onClick={() =>
                      setRows((current) =>
                        current.filter(
                          (candidate) => candidate.key !== row.key,
                        ),
                      )
                    }
                    className="text-error-500 text-sm font-medium hover:underline disabled:cursor-not-allowed disabled:text-gray-300 dark:disabled:text-gray-700"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        {/*
          A plain <button type="button">, not the shared `Button`.
          `Button` does not expose `type`, so it renders as the HTML default
          `submit` — inside this form, clicking "Add line" would submit the
          journal instead of adding a row.
        */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setRows((current) => [...current, blankRow()])}
          className="shadow-theme-xs inline-flex items-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
        >
          Add line
        </button>

        <div className="flex flex-wrap items-center gap-5 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            Debit{" "}
            <span className="font-medium text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(totals.debit.toString())}
            </span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Credit{" "}
            <span className="font-medium text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(totals.credit.toString())}
            </span>
          </span>

          {totals.balanced ? (
            <span className="text-success-600 dark:text-success-400 font-medium">
              Balanced
            </span>
          ) : (
            <span className="text-warning-600 dark:text-warning-400 font-medium">
              Out of balance by {formatPaise(difference.toString())}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
