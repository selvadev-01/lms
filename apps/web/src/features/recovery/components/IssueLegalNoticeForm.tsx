"use client";

import { Alert } from "@lms/ui";
import { useActionState } from "react";

import { Field, SubmitButton } from "@/components/form/FormFields";
import { issueLegalNoticeAction } from "../actions/recovery-actions";

/**
 * Issuing a legal notice.
 *
 * A document reference, not a money movement: no journal, no idempotency key.
 *
 * # The expiry date is not asked for
 *
 * It is derived server-side from the notice date and the period, so
 * `legal_notices_expiry_after_notice` cannot be violated by a form. Asking for
 * both a period and an expiry would let the two disagree, and the operator
 * would be the one to reconcile them.
 *
 * Issuing a notice moves the case to LEGAL_NOTICE and freezes an action row
 * recording it — a notice is a decision, not a draft.
 */
export default function IssueLegalNoticeForm({
  recoveryCaseId,
}: {
  recoveryCaseId: string;
}) {
  const [state, formAction] = useActionState(issueLegalNoticeAction, {});

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Issue legal notice
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />

      {state.message ? (
        <div className="mt-4">
          <Alert variant="error" title="Not issued" message={state.message} />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Issued" message={state.success} />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <Field
          name="noticeDate"
          label="Notice Date"
          type="date"
          errors={state.errors?.noticeDate}
          required
        />
        <Field
          name="noticePeriodDays"
          label="Notice Period (days)"
          type="number"
          inputMode="numeric"
          defaultValue="30"
          errors={state.errors?.noticePeriodDays}
          required
          hint="The expiry date is calculated from this."
        />
        <Field
          name="noticeReference"
          label="Notice Reference"
          errors={state.errors?.noticeReference}
          maxLength={150}
        />
        <Field
          name="documentRef"
          label="Document Reference"
          errors={state.errors?.documentRef}
          maxLength={500}
        />
      </div>

      <div className="mt-5">
        <SubmitButton label="Issue notice" pendingLabel="Issuing…" />
      </div>
    </form>
  );
}
