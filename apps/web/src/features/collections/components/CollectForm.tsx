"use client";

import type { AllocationPreview, CollectionReadiness } from "@lms/types";
import { Alert } from "@lms/ui";
import { COLLECTION_PAYMENT_MODE_OPTIONS } from "@lms/validation";
import { useActionState, useEffect, useState, useTransition } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import { formatPaise } from "@/lib/format";
import {
  rupeesToPaise,
  paiseToRupees,
} from "@/features/loans/components/FormParts";

import {
  postCollectionAction,
  previewAllocationAction,
  type CollectionFormState,
} from "../actions/collection-actions";
import AllocationSummary from "./AllocationSummary";
import { todayIso } from "@/lib/business-date";

/**
 * Take a payment against a loan (Scenarios 5, 6, 7, 9, 10, 11, 12).
 *
 * # The idempotency key is minted once per mount
 *
 * `useState(() => crypto.randomUUID())` runs its initialiser exactly once for
 * the life of this component. That is the whole mechanism: a key regenerated on
 * each submit would make a retry look like a different payment and post it
 * twice. If the operator genuinely wants to take a second payment, they
 * navigate back to a fresh form and get a fresh key.
 *
 * # Rupees in, paise on the wire
 *
 * The visible field is rupees because that is what a borrower hands over. A
 * hidden field carries the converted integer-paise digit string, via the same
 * `rupeesToPaise` every other money form uses — never `value * 100`, which
 * rounds a paisa away on values a float cannot hold exactly.
 *
 * # Why "pay in full" fills an exact paise figure
 *
 * Overpayment is refused with a 400. A borrower tendering a round rupee sum a
 * few paise above the true outstanding would simply be rejected, so the button
 * fills the exact figure the server will accept rather than a rounded one.
 */
export default function CollectForm({
  readiness,
}: {
  readiness: CollectionReadiness;
}) {
  const [state, formAction] = useActionState<CollectionFormState, FormData>(
    postCollectionAction,
    {},
  );

  // Minted once per mount. See the class comment — this is the mechanism.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [rupees, setRupees] = useState("");
  const [paymentMode, setPaymentMode] = useState("CASH");
  /**
   * The last preview the server returned, tagged with the amount it was for.
   *
   * Tagged rather than cleared by an effect: when the amount changes, the old
   * preview stops matching and is simply not rendered. Clearing it with a
   * `setState` inside the effect would be a cascading render — and would also
   * flash the panel away and back on every keystroke.
   */
  const [previewFor, setPreviewFor] = useState<{
    amountPaise: string;
    preview: AllocationPreview;
  } | null>(null);
  const [previewing, startPreview] = useTransition();

  // `BigInt("0")` rather than a `0n` literal: the web app targets ES2017, where
  // BigInt literals are a syntax error even though the runtime supports the type.
  const amountPaise = rupeesToPaise(rupees);
  const hasAmount = Boolean(amountPaise) && BigInt(amountPaise) > BigInt("0");
  const needsReference =
    paymentMode === "UPI" || paymentMode === "BANK_TRANSFER";

  // Derived, not synced: the preview shows only if it is for the amount
  // currently typed.
  const preview =
    previewFor && previewFor.amountPaise === amountPaise
      ? previewFor.preview
      : null;

  // The preview is asked of the server, debounced, so it agrees with what
  // posting will actually do rather than approximating it in the browser.
  useEffect(() => {
    if (!hasAmount) return;

    const timer = setTimeout(() => {
      startPreview(async () => {
        const result = await previewAllocationAction(
          readiness.loanId,
          amountPaise,
        );
        if ("status" in result) {
          setPreviewFor({ amountPaise, preview: result.preview });
        }
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [amountPaise, hasAmount, readiness.loanId]);

  if (!readiness.collectable) {
    return (
      <Alert
        variant="warning"
        title="This loan cannot take a collection"
        message={readiness.blockers.map((blocker) => blocker.reason).join(" ")}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="loanId" value={readiness.loanId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="amountPaise" value={amountPaise} />

      {state.message && (
        <Alert variant="error" title="Could not post" message={state.message} />
      )}

      {state.blockers && state.blockers.length > 0 && (
        <Alert
          variant="warning"
          title="This collection was refused"
          message={state.blockers.map((blocker) => blocker.reason).join(" ")}
        />
      )}

      {/*
        The server refused an overpayment and told us the exact ceiling. Offer
        it rather than leaving the operator to work it out.
      */}
      {state.maxCollectablePaise && (
        <Alert
          variant="warning"
          title="More than is owed"
          message={`The most this loan can accept is ${formatPaise(
            state.maxCollectablePaise,
          )}.`}
        />
      )}

      <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-gray-800 dark:text-white/90">
              {readiness.customerName}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {readiness.loanNumber}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Outstanding
            </p>
            <p className="text-lg font-semibold text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(readiness.totalOutstandingPaise)}
            </p>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Field
              name="amountRupees"
              label="Collected Amount"
              required
              inputMode="decimal"
              placeholder="0.00"
              value={rupees}
              onChange={setRupees}
              errors={state.errors?.amountPaise}
              hint="In rupees. Paise are allowed."
            />
            {/*
              A plain button, not the shared `Button`: that component renders a
              bare <button>, which defaults to type="submit" and would post the
              form instead of filling the field. Widening its props for this one
              case would put a submit/reset footgun on every other caller.
            */}
            <button
              type="button"
              className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              onClick={() =>
                setRupees(paiseToRupees(readiness.totalOutstandingPaise))
              }
            >
              Pay in full
            </button>
          </div>

          <Field
            name="collectionDate"
            label="Collection Date"
            required
            type="date"
            // The Kolkata business date, not `toISOString()`. That returns the
            // UTC date, so an evening collection defaulted to yesterday.
            defaultValue={todayIso()}
            errors={state.errors?.collectionDate}
          />

          <SelectField
            name="paymentMode"
            label="Payment Mode"
            required
            options={COLLECTION_PAYMENT_MODE_OPTIONS}
            value={paymentMode}
            onChange={setPaymentMode}
            errors={state.errors?.paymentMode}
          />

          {/*
            Rendered only for the modes that settle through a bank. The server
            enforces the requirement regardless — a field-level conditional here
            is presentation, not validation.
          */}
          {needsReference && (
            <Field
              name="transactionReference"
              label="Payment Reference"
              required
              maxLength={150}
              placeholder="UTR or UPI reference"
              errors={state.errors?.transactionReference}
            />
          )}
        </div>

        <div className="mt-5">
          <TextAreaField
            name="notes"
            label="Notes"
            maxLength={1000}
            errors={state.errors?.notes}
          />
        </div>
      </section>

      {preview && (
        <AllocationSummary
          heading={previewing ? "Allocation (updating…)" : "Allocation"}
          components={{
            penaltyPaise: preview.penaltyPaise,
            interestPaise: preview.interestPaise,
            principalPaise: preview.principalPaise,
            feesPaise: preview.feesPaise,
            unallocatedPaise: preview.unallocatedPaise,
            totalPaise: preview.amountPaise,
          }}
          lines={preview.lines}
        />
      )}

      {preview?.wouldCloseLoan && (
        <Alert
          variant="info"
          title="This clears the loan"
          message="The payment settles every remaining obligation on this loan."
        />
      )}

      <SubmitButton label="Post collection" pendingLabel="Posting…" />
    </form>
  );
}
