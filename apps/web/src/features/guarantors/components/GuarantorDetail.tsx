"use client";

import type { GuarantorProfileResponse } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Imported from the module, not from `@/features/customers`, and this is
 * deliberate: the customers barrel re-exports its `server-only` `api/` module,
 * so a client component reaching through it fails the build. Consent is a
 * customer-domain concept shared with guarantors, and its colour scale is
 * defined once in `CustomerStatusBadge` on purpose — see the docblock there.
 */
import { ConsentStatusBadge } from "@/features/customers/components/CustomerStatusBadge";
import {
  deactivateGuarantorAction,
  reactivateGuarantorAction,
  type GuarantorLifecycleState,
} from "../actions/guarantor-lifecycle-actions";
import GuarantorKycPanel from "./GuarantorKycPanel";
import { GuarantorStatusBadge } from "./GuarantorStatusBadge";

/**
 * Guarantor detail (Module 05, GUA-002, Scenario 2).
 *
 * Read-and-lifecycle only. Editing a guarantor's identity stays on the customer
 * profile tab, because a guarantor is defined by the customer they stand for and
 * an edit form reachable without naming that customer would invite the
 * client-supplied relationship Scenario 14 forbids.
 *
 * The customer is a link, not a label: "who is this person guaranteeing" is the
 * question that brings anyone to this screen, and a dead-end would send them
 * back to search for a name they can already see.
 *
 * Deactivation asks for a reason and says what it will not do. Rules 35 and 38
 * mean historical loan relationships survive, and a user choosing between
 * "Deactivate" and the delete on the customer tab needs to know that.
 */

const initial: GuarantorLifecycleState = {};

function SubmitButton({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "outline";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export default function GuarantorDetail({
  profile,
  canDeactivate = false,
  canUpload = false,
  canVerifyDocuments = false,
  canSubmitKyc = false,
  canReviewKyc = false,
  canDownload = false,
}: {
  profile: GuarantorProfileResponse;
  canDeactivate?: boolean;
  canUpload?: boolean;
  canVerifyDocuments?: boolean;
  canSubmitKyc?: boolean;
  canReviewKyc?: boolean;
  canDownload?: boolean;
}) {
  const { guarantor, documents } = profile;

  const [deactivateState, deactivateFormAction] = useActionState(
    deactivateGuarantorAction,
    initial,
  );
  const [reactivateState, reactivateFormAction] = useActionState(
    reactivateGuarantorAction,
    initial,
  );
  const [confirming, setConfirming] = useState(false);

  const state = deactivateState.message ? deactivateState : reactivateState;
  const errors = deactivateState.errors ?? {};

  const ids = (
    <>
      <input type="hidden" name="customerId" value={guarantor.customerId} />
      <input type="hidden" name="guarantorId" value={guarantor.guarantorId} />
      <input type="hidden" name="expectedVersion" value={guarantor.version} />
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            {guarantor.fullName}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Guarantor for{" "}
            <Link
              href={`/customers/${guarantor.customerId}`}
              className="text-brand-500 hover:underline"
            >
              {guarantor.customerName} ({guarantor.customerCode})
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GuarantorStatusBadge status={guarantor.status} />
          <ConsentStatusBadge status={guarantor.consentStatus} />
        </div>
      </div>

      {state.message && (
        <Alert
          variant="error"
          title="Could not continue"
          message={state.message}
        />
      )}
      {state.success && (
        <Alert variant="success" title="Done" message={state.success} />
      )}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">Mobile</dt>
          <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
            {guarantor.mobile}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">
            Relationship
          </dt>
          <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
            {guarantor.relationship ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-gray-500 dark:text-gray-400">Address</dt>
          <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
            {guarantor.address ?? "—"}
          </dd>
        </div>
        {/*
          The decision and when it was made. The timestamp appears only for
          GIVEN, because a rejection has a decision but no consent.
        */}
        {guarantor.consentAt && (
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              Consent recorded
            </dt>
            <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
              {new Date(guarantor.consentAt).toLocaleString()}
            </dd>
          </div>
        )}
        {guarantor.status === "INACTIVE" && guarantor.deactivationReason && (
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              Deactivated
            </dt>
            <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
              {guarantor.deactivationReason}
            </dd>
          </div>
        )}
      </dl>

      <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
        <GuarantorKycPanel
          guarantor={guarantor}
          documents={documents}
          canUpload={canUpload}
          canVerify={canVerifyDocuments}
          canSubmit={canSubmitKyc}
          canReview={canReviewKyc}
          canDownload={canDownload}
        />
      </div>

      {canDeactivate && (
        <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
          {guarantor.status === "ACTIVE" ? (
            confirming ? (
              <form
                action={deactivateFormAction}
                className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
              >
                {ids}

                <div>
                  <label
                    htmlFor="deactivation-reason"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  >
                    Reason <span className="text-error-500">*</span>
                  </label>
                  <textarea
                    id="deactivation-reason"
                    name="reason"
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2 text-sm dark:border-gray-700 dark:text-white/90"
                  />
                  {errors.reason && (
                    <p className="text-error-500 mt-1.5 text-sm">
                      {errors.reason[0]}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    The guarantor will not be selectable for new applications.
                    Existing loan relationships are kept.
                  </p>
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </Button>
                  <SubmitButton label="Deactivate Guarantor" />
                </div>
              </form>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(true)}
              >
                Deactivate Guarantor
              </Button>
            )
          ) : (
            <form action={reactivateFormAction}>
              {ids}
              <SubmitButton label="Reactivate Guarantor" variant="outline" />
            </form>
          )}
        </div>
      )}
    </div>
  );
}
