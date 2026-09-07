"use client";

import type {
  LoanApplicationSummary,
  LoanSummaryView,
  PortfolioReportRow,
  RepaymentScheduleView,
} from "@lms/types";
import type { CustomerProfileResponse } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import type { SelectOption } from "@lms/validation";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  convertCustomerAction,
  deleteCustomerAction,
  sendMobileOtpAction,
  setCustomerStatusAction,
  verifyMobileOtpAction,
  type CustomerFormState,
} from "../actions/customer-actions";
import CustomerForm from "./CustomerForm";
import { CustomerStatusBadge, CustomerTypeBadge } from "./CustomerStatusBadge";
import GuarantorList from "./GuarantorList";
import { ReadField, ReadFields } from "@/components/common/ReadField";

import CustomerPortfolio from "./CustomerPortfolio";
import KycPanel from "./KycPanel";

/**
 * The customer profile screen (Module 04, Scenarios 22-23).
 *
 * Tabs rather than one long page, because the four concerns have different
 * audiences: a clerk edits details, a reviewer works the KYC pack, and a
 * collections officer wants the loans. Stacking them would bury whichever one
 * the visitor came for.
 *
 * **The KYC tab is absent for a LOCAL customer**, not empty and not disabled.
 * A LOCAL customer has no KYC record at all (Q-CUST-2), and rendering a greyed
 * tab would suggest something is missing rather than not applicable — the exact
 * confusion the explicit customer type exists to prevent. They get a mobile
 * verification panel instead, which is their whole identity check.
 *
 * Every control is gated on a capability prop. A caller who reaches this screen
 * without `customers.update` sees the details and no Save button, which is
 * Scenario 23 rendered as well as enforced.
 */

const initial: CustomerFormState = {};

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

type Tab = "details" | "kyc" | "guarantors" | "loans";

export default function CustomerProfile({
  profile,
  loans,
  applications,
  positions,
  canSeeBalances,
  schedules,
  canUpdate = false,
  canVerifyMobile = false,
  canActivate = false,
  canDelete = false,
  canConvert = false,
  canKycView = false,
  canKycSubmit = false,
  canKycApprove = false,
  canUpload = false,
  canVerifyDocuments = false,
  canDownload = false,
  canManageGuarantors = false,
  canViewGuarantors = false,
  canDeactivateGuarantors = false,
  canDeleteGuarantors = false,
  relationshipOptions = [],
  genderOptions = [],
}: {
  profile: CustomerProfileResponse;
  /**
   * This customer's loans and applications, for the Loans tab.
   *
   * Fetched by the page rather than here so the reads happen alongside the
   * profile's own, and both default to empty — a failed loan read leaves the
   * tab saying "nothing yet" rather than taking down a page about the customer.
   */
  loans: LoanSummaryView[];
  applications: LoanApplicationSummary[];
  /** Per-loan outstanding and arrears; empty without the reports permission. */
  positions: PortfolioReportRow[];
  canSeeBalances: boolean;
  /** Instalment lists for the first few loans — see the page for the bound. */
  schedules: RepaymentScheduleView[];
  canUpdate?: boolean;
  /**
   * Separate from `canUpdate`: a field agent verifies a customer's number
   * without being able to edit the customer afterwards.
   */
  canVerifyMobile?: boolean;
  canActivate?: boolean;
  canDelete?: boolean;
  canConvert?: boolean;
  canKycView?: boolean;
  canKycSubmit?: boolean;
  canKycApprove?: boolean;
  canUpload?: boolean;
  canVerifyDocuments?: boolean;
  canDownload?: boolean;
  canManageGuarantors?: boolean;
  /** Gates the link through to the guarantor detail screen (GUA-002). */
  canViewGuarantors?: boolean;
  canDeactivateGuarantors?: boolean;
  /**
   * Separate from `canManageGuarantors` because Scenario 40 needs a role that
   * reaches this tab and is refused deletion specifically — Branch Admin is
   * exactly that role.
   */
  canDeleteGuarantors?: boolean;
  /** Passed through to the guarantor form's Relationship dropdown. */
  relationshipOptions?: SelectOption[];
  /** Passed through to the edit form's Gender dropdown. */
  genderOptions?: SelectOption[];
}) {
  const { customer, kyc, documents, guarantors } = profile;
  const isLocal = customer.customerType === "LOCAL";

  const [tab, setTab] = useState<Tab>("details");
  /**
   * Whether the details form is open.
   *
   * Reset when the tab changes, so returning to Details lands on the read view
   * rather than stranding a half-filled form nobody meant to leave open.
   */
  const [editing, setEditing] = useState(false);
  const [statusState, statusFormAction] = useActionState(
    setCustomerStatusAction,
    initial,
  );
  const [convertState, convertFormAction] = useActionState(
    convertCustomerAction,
    initial,
  );
  const [deleteState, deleteFormAction] = useActionState(
    deleteCustomerAction,
    initial,
  );
  const [otpState, otpFormAction] = useActionState(
    sendMobileOtpAction,
    initial,
  );
  const [verifyState, verifyFormAction] = useActionState(
    verifyMobileOtpAction,
    initial,
  );

  const banner = [
    statusState,
    convertState,
    deleteState,
    otpState,
    verifyState,
  ].find((s) => s.message ?? s.success);

  const tabs: Array<[Tab, string]> = [
    ["details", "Details"],
    ...((!isLocal && canKycView ? [["kyc", "KYC"]] : []) as Array<
      [Tab, string]
    >),
    ["guarantors", "Guarantors"],
    // "Loans" rather than "Active Loans": the tab shows closed loans and
    // applications in progress too, so the narrower label would be wrong.
    ["loans", "Loans"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
              {customer.fullName}
            </h2>
            <CustomerTypeBadge type={customer.customerType} />
            <CustomerStatusBadge status={customer.status} />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {customer.customerCode} · {customer.mobile}
            {customer.branchName ? ` · ${customer.branchName}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canActivate && customer.status !== "ACTIVE" && (
            <form action={statusFormAction}>
              <input
                type="hidden"
                name="customerId"
                value={customer.customerId}
              />
              <input type="hidden" name="status" value="ACTIVE" />
              <SubmitButton label="Activate" variant="outline" />
            </form>
          )}

          {canActivate && customer.status === "ACTIVE" && (
            <form action={statusFormAction}>
              <input
                type="hidden"
                name="customerId"
                value={customer.customerId}
              />
              <input type="hidden" name="status" value="INACTIVE" />
              <SubmitButton label="Deactivate" variant="outline" />
            </form>
          )}

          {/* Scenario 27 — offered only where it is actually possible. */}
          {canConvert && isLocal && (
            <form action={convertFormAction}>
              <input
                type="hidden"
                name="customerId"
                value={customer.customerId}
              />
              <input
                type="hidden"
                name="expectedVersion"
                value={customer.version}
              />
              <SubmitButton label="Convert to KYC" variant="outline" />
            </form>
          )}

          {canDelete && (
            <form action={deleteFormAction}>
              <input
                type="hidden"
                name="customerId"
                value={customer.customerId}
              />
              <SubmitButton label="Delete" variant="outline" />
            </form>
          )}
        </div>
      </div>

      {banner?.message && (
        <Alert
          variant="error"
          title="Could not continue"
          message={banner.message}
        />
      )}
      {banner?.success && (
        <Alert variant="success" title="Done" message={banner.success} />
      )}

      {/*
        Scenario 37 — a refused delete names what stands in the way, so the user
        is told to deactivate rather than left guessing why nothing happened.
      */}
      {deleteState.blockedBy && deleteState.blockedBy.length > 0 && (
        <div className="border-warning-300 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10 rounded-2xl border p-4">
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            This customer has records that must be kept
          </p>
          <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {deleteState.blockedBy.map((blocker) => (
              <li key={blocker.entity}>
                {blocker.label}: {blocker.count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Scenario 14 — a LOCAL customer's only identity check. Shown until the
        number is verified, because verifying it is what activates them.
      */}
      {isLocal && !customer.mobileVerified && canVerifyMobile && (
        <div className="border-warning-300 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10 rounded-2xl border p-4">
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            Mobile number not verified
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Send a code to this customer&rsquo;s mobile and enter it below.
            Verifying the number activates this Local customer.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <form action={otpFormAction}>
              <input
                type="hidden"
                name="customerId"
                value={customer.customerId}
              />
              <SubmitButton label="Send Code" variant="outline" />
            </form>

            <form action={verifyFormAction} className="flex items-end gap-2">
              <input
                type="hidden"
                name="customerId"
                value={customer.customerId}
              />
              <div>
                <label
                  htmlFor="otp"
                  className="mb-1 block text-xs text-gray-500 dark:text-gray-400"
                >
                  Verification code
                </label>
                <input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="off"
                  className="h-9 w-32 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90"
                />
              </div>
              <SubmitButton label="Verify" variant="outline" />
            </form>
          </div>
          {verifyState.errors?.otp && (
            <p className="text-error-500 mt-1.5 text-sm">
              {verifyState.errors.otp[0]}
            </p>
          )}
        </div>
      )}

      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="-mb-px flex flex-wrap gap-6" aria-label="Customer">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setEditing(false);
              }}
              aria-current={tab === value ? "page" : undefined}
              className={`border-b-2 pb-3 text-sm font-medium ${
                tab === value
                  ? "border-brand-500 text-brand-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "details" && (
        <div className="space-y-4">
          {/*
            Read first, edit on request.
            
            This used to render the form outright to anyone holding
            `customers.update`, so "view a customer" and "edit a customer" were
            the same screen and every field sat in an input nobody had asked to
            change. The read layout below already existed — it was shown only to
            callers who *could not* edit, which is precisely backwards from who
            spends most time reading.
          */}
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
              {editing ? "Edit details" : "Details"}
            </h3>
            {/* Absent, not disabled, without the permission: an editor's
                control that appears and then refuses is worse than one that was
                never offered. */}
            {canUpdate && (
              <button
                type="button"
                onClick={() => setEditing((open) => !open)}
                className="text-brand-500 text-sm font-medium hover:underline"
              >
                {editing ? "Cancel" : "Edit"}
              </button>
            )}
          </div>

          {editing && canUpdate ? (
            <CustomerForm customer={customer} genderOptions={genderOptions} />
          ) : (
            <ReadFields>
              <ReadField label="Full Name" value={customer.fullName} />
              <ReadField label="Mobile Number" value={customer.mobile} />
              <ReadField label="Email" value={customer.email} />
              <ReadField label="Date of Birth" value={customer.dateOfBirth} />
              <ReadField label="Gender" value={customer.gender} />
              <ReadField label="Address" value={customer.addressLine1} />
              <ReadField label="Address Line 2" value={customer.addressLine2} />
              <ReadField label="City" value={customer.city} />
              <ReadField label="State" value={customer.state} />
              <ReadField label="Postal Code" value={customer.pincode} />
            </ReadFields>
          )}
        </div>
      )}

      {tab === "kyc" && kyc && (
        <KycPanel
          customerId={customer.customerId}
          kyc={kyc}
          documents={documents}
          canUpload={canUpload}
          canVerify={canVerifyDocuments}
          canSubmit={canKycSubmit}
          canApprove={canKycApprove}
          canDownload={canDownload}
        />
      )}

      {tab === "guarantors" && (
        <GuarantorList
          customerId={customer.customerId}
          guarantors={guarantors}
          canManage={canManageGuarantors}
          canView={canViewGuarantors}
          canDeactivate={canDeactivateGuarantors}
          canDelete={canDeleteGuarantors}
          relationshipOptions={relationshipOptions}
        />
      )}

      {/*
        Scenario 22 — the customer's permitted loans. This said "Loan Management
        does not exist yet" until Modules 07-14 shipped; the placeholder outlived
        the gap it described, which is why the screen was claiming a built
        feature was missing.
      */}
      {tab === "loans" && (
        <CustomerPortfolio
          positions={positions}
          loans={loans}
          applications={applications}
          canSeeBalances={canSeeBalances}
          schedules={schedules}
        />
      )}
    </div>
  );
}
