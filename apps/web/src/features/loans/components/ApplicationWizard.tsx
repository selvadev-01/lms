"use client";

import type {
  CustomerSummary,
  EmiScheduleView,
  LoanSchemeSummary,
} from "@lms/types";
import { Alert, Button } from "@lms/ui";
import {
  INTEREST_TYPE_OPTIONS,
  LOAN_TYPE_OPTIONS,
  REPAYMENT_FREQUENCY_OPTIONS,
  labelFor,
  pick,
  type SelectOption,
} from "@lms/validation";
import Link from "next/link";
import React, { useActionState, useEffect, useMemo, useState } from "react";

import { createApplicationAction } from "../actions/loan-application-actions";
import {
  Field,
  percentToBps,
  rupeesToPaise,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "./FormParts";
import EmiSchedulePanel from "./EmiSchedulePanel";
import { formatBps, formatPaise } from "./LoanBadges";

/**
 * The six-step loan application wizard (APP-001, P0 wireframe).
 *
 * # Why only four steps are here
 *
 * The source defines six: Customer, Loan Details, Scheme & Terms, EMI Preview,
 * Documents, Review & Submit. This component covers steps 1-4 and a create
 * button; documents (5) and review-and-submit (6) live on the application's own
 * detail page.
 *
 * That split follows from the schema, not from taste. `LoanApplication` has nine
 * non-null columns, so no row can exist until customer, amount and terms are all
 * chosen — and a document cannot be attached to an application that does not
 * exist yet. Making those columns nullable to allow a half-empty draft would
 * force every later reader, through approval and disbursal, to null-check
 * columns that are populated for every row that reaches them (D-APP-1).
 *
 * So: steps 1-3 collect, step 4 previews, and creating the draft is what unlocks
 * 5 and 6. A user who abandons before creating loses their typing, which is the
 * cost of that decision and is worth revisiting if branch staff complain.
 *
 * # Why the preview is a server round trip
 *
 * Step 4 calls the API rather than computing locally, even though `@lms/emi` is
 * importable here. The server's answer is the authoritative one — it is what
 * submit and approve recompute against — and a locally-derived figure that
 * disagreed by a paisa would be worse than a spinner.
 */

const STEPS = [
  "Customer",
  "Loan Details",
  "Scheme & Terms",
  "EMI Preview",
] as const;

interface Props {
  customers: CustomerSummary[];
  schemes: LoanSchemeSummary[];
  /** Scheme id -> the frequency/duration pairs it actually offers. */
  schemeTerms: Record<
    string,
    Array<{ frequency: string; durationCount: number }>
  >;
  /** Scheme id -> its parent product's loan type, for the step 2 filter. */
  schemeTypes: Record<string, string>;
  canOverrideRate: boolean;
  /**
   * From the LOAN_PURPOSE master-data list. Unlike the optional gender and
   * relationship lists, purpose is required — so an empty list is surfaced as a
   * hint on the field rather than silently leaving it unfillable.
   */
  purposeOptions: SelectOption[];
}

export default function ApplicationWizard({
  customers,
  schemes,
  schemeTerms,
  schemeTypes,
  canOverrideRate,
  purposeOptions,
}: Props) {
  const [step, setStep] = useState(0);
  const [state, formAction] = useActionState(createApplicationAction, {});

  const [customerId, setCustomerId] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  /** Server results for the current term; null means "nothing typed yet". */
  const [matches, setMatches] = useState<CustomerSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loanType, setLoanType] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  // Purpose is submitted as one string but captured as two controls: a managed
  // category for reporting, plus optional detail so a borrower's actual reason
  // is not flattened into whichever list entry is closest. The API still sees a
  // single `purpose` field, so neither the schema nor the column changes.
  const [purposeCode, setPurposeCode] = useState("");
  const [purposeDetail, setPurposeDetail] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [interestType, setInterestType] = useState("");
  const [ratePercent, setRatePercent] = useState("");
  const [frequency, setFrequency] = useState("");
  const [durationCount, setDurationCount] = useState("");

  const [preview, setPreview] = useState<EmiScheduleView | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const errors = state.errors ?? {};

  /**
   * The single `purpose` string the API stores.
   *
   * The category's *label* leads rather than its code, so the stored value reads
   * as a sentence in a list or a report ("Home improvement — new roof") instead
   * of as an identifier. Applications written before this was a managed list are
   * plain sentences too, so old and new records still read alike.
   */
  const composedPurpose = useMemo(() => {
    const label = labelFor(purposeOptions, purposeCode);
    const detail = purposeDetail.trim();
    if (!label) return detail;
    return detail ? `${label} — ${detail}` : label;
  }, [purposeOptions, purposeCode, purposeDetail]);

  /**
   * The chosen customer, held rather than looked up.
   *
   * Searching replaces the visible rows, so a customer picked from one result
   * set is not in the next one — and steps 2-4 and the review summary still have
   * to name who this application is for. Looking the id up in the current list
   * would blank the summary the moment the term changed.
   */
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const scheme = schemes.find((row) => row.loanSchemeId === schemeId);

  /** Only schemes under a product of the chosen type (Rule 12, step 2). */
  const schemesForType = useMemo(
    () =>
      loanType
        ? schemes.filter((row) => schemeTypes[row.loanSchemeId] === loanType)
        : schemes,
    [schemes, schemeTypes, loanType],
  );

  const terms = schemeId ? (schemeTerms[schemeId] ?? []) : [];
  const frequenciesOffered = [...new Set(terms.map((term) => term.frequency))];
  const durationsOffered = terms
    .filter((term) => term.frequency === frequency)
    .map((term) => term.durationCount)
    .sort((a, b) => a - b);

  /**
   * Step 1's customer lookup, resolved by the server.
   *
   * Filtering the pre-fetched array in the browser was the earlier approach and
   * was wrong in two ways: it shipped every active customer to the client, and
   * the display cap that kept that tolerable also made any customer past the cap
   * unfindable — which is Rule 19's search failing silently on exactly the
   * tenants large enough to need it.
   *
   * The API resolves the term as name-contains / code-exact / mobile-prefix, so
   * the match rules live in one place rather than being re-implemented here.
   * `customers` is still the first page, used until the user types.
   */
  useEffect(() => {
    const needle = customerFilter.trim();
    const controller = new AbortController();

    // Debounced so a typed word is one request, not one per keystroke. The
    // cleared-input case runs on the same timer rather than synchronously in the
    // effect body, which would be a cascading render.
    const timer = setTimeout(() => {
      if (!needle) {
        setMatches(null);
        setSearchError(null);
        return;
      }

      setSearching(true);
      fetch(`/api/customers/search?search=${encodeURIComponent(needle)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("search failed");
          const body = (await response.json()) as {
            customers?: CustomerSummary[];
          };
          setMatches(body.customers ?? []);
          setSearchError(null);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          // An empty list would claim "no such customer", which is a different
          // statement from "we could not look".
          setMatches([]);
          setSearchError("Could not search customers. Try again.");
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [customerFilter]);

  const visibleCustomers = matches ?? customers;

  const amountPaise = rupeesToPaise(amountRupees);
  const rateBps = percentToBps(ratePercent);

  /** What each step needs before Next means anything. */
  const stepComplete = [
    Boolean(customerId),
    Boolean(loanType && amountPaise && amountPaise !== "0" && purposeCode),
    Boolean(schemeId && interestType && rateBps && frequency && durationCount),
    // Step 4 gates on the preview having actually resolved: an EMI that does not
    // compute blocks submission anyway (Scenario 12), so letting the user past
    // this point would only defer the refusal.
    preview !== null,
  ];

  /**
   * Selecting a scheme adopts its price.
   *
   * The rate is prefilled rather than left blank because the scheme *is* the
   * price list — typing it again invites a transcription error that would then
   * need the override permission to save.
   */
  function chooseScheme(next: string) {
    setSchemeId(next);
    setFrequency("");
    setDurationCount("");
    setPreview(null);

    const chosen = schemes.find((row) => row.loanSchemeId === next);
    if (chosen) {
      setInterestType(chosen.interestType);
      setRatePercent(bps(chosen.interestRateBps));
    }
  }

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);

    try {
      const response = await fetch("/api/loan-applications/emi-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principalPaise: amountPaise,
          annualRateBps: rateBps,
          interestType,
          frequency,
          durationCount: Number(durationCount),
        }),
      });

      if (!response.ok) {
        setPreview(null);
        setPreviewError(
          "These terms do not produce a repayment schedule. Adjust the amount, rate or duration.",
        );
        return;
      }

      setPreview((await response.json()) as EmiScheduleView);
    } catch {
      setPreview(null);
      setPreviewError("Could not calculate the schedule. Please try again.");
    } finally {
      setPreviewing(false);
    }
  }

  const rateDiffersFromScheme =
    scheme !== undefined &&
    rateBps !== "" &&
    rateBps !== scheme.interestRateBps;

  return (
    <form action={formAction} className="space-y-6">
      <Stepper current={step} completed={stepComplete} />

      {state.message && (
        <Alert
          variant="error"
          title="Could not create application"
          message={state.message}
        />
      )}

      {/* Every collected value travels as a hidden input, so the server action
          receives the whole application regardless of which step is on screen. */}
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="loanSchemeId" value={schemeId} />
      <input type="hidden" name="requestedAmountPaise" value={amountPaise} />
      <input type="hidden" name="purpose" value={composedPurpose} />
      <input type="hidden" name="interestType" value={interestType} />
      <input type="hidden" name="interestRateBps" value={rateBps} />
      <input type="hidden" name="repaymentFrequency" value={frequency} />
      <input type="hidden" name="durationCount" value={durationCount} />

      {step === 0 && (
        <section className="space-y-4">
          <Field
            name="customer-search"
            label="Search customers"
            value={customerFilter}
            onChange={setCustomerFilter}
            placeholder="Name, customer ID or mobile"
            hint="Only customers in your branch are listed."
          />

          {searching && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Searching…
            </p>
          )}

          {/* An outage is not an answer about whether the customer exists, so it
              is said plainly instead of rendering as an empty result. */}
          {searchError && (
            <Alert
              variant="error"
              title="Customer search unavailable"
              message={searchError}
            />
          )}

          {!searching && !searchError && visibleCustomers.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No customer matches that search.
              </p>
              {/* Scenario 6: the source's "Verify & Create Customer Record" path.
                  Module 04 owns customer creation; this links to it rather than
                  building a parallel customer form. */}
              <Link href="/customers/new">
                <Button size="sm" variant="outline">
                  Create customer record
                </Button>
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {visibleCustomers.map((row) => (
                <li key={row.customerId}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                    <input
                      type="radio"
                      name="customer-choice"
                      value={row.customerId}
                      checked={customerId === row.customerId}
                      onChange={() => {
                        setCustomerId(row.customerId);
                        setCustomer(row);
                      }}
                      className="text-brand-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-800 dark:text-white/90">
                        {row.fullName}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {row.customerCode} · {row.mobile} · {row.status}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {errors.customerId && (
            <p className="text-error-500 text-sm">{errors.customerId[0]}</p>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="grid gap-5 sm:grid-cols-2">
          <SelectField
            name="loan-type"
            label="Loan Type"
            required
            value={loanType}
            onChange={(next) => {
              setLoanType(next);
              // The scheme belongs to a product of a specific type, so changing
              // the type invalidates any scheme already chosen.
              setSchemeId("");
              setPreview(null);
            }}
            options={LOAN_TYPE_OPTIONS}
          />

          <Field
            name="amount-rupees"
            label="Loan Amount (₹)"
            required
            inputMode="decimal"
            value={amountRupees}
            onChange={(next) => {
              setAmountRupees(next);
              setPreview(null);
            }}
            placeholder="100000.00"
            errors={errors.requestedAmountPaise}
            hint="Entered in rupees; stored to the paisa."
          />

          <SelectField
            name="purpose-choice"
            label="Purpose"
            required
            value={purposeCode}
            onChange={setPurposeCode}
            options={purposeOptions}
            errors={errors.purpose}
            hint={
              purposeOptions.length === 0
                ? "Purpose options could not be loaded."
                : undefined
            }
          />

          <div className="sm:col-span-2">
            <TextAreaField
              name="purpose-detail"
              label="Purpose detail (optional)"
              value={purposeDetail}
              onChange={setPurposeDetail}
              // The composed value must fit the column, and the label it is
              // appended to is at most 200 characters of the 500 available.
              maxLength={280}
              placeholder="Anything more the branch should know"
            />
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SelectField
              name="scheme-choice"
              label="Loan Scheme"
              required
              value={schemeId}
              onChange={chooseScheme}
              options={schemesForType.map((row) => ({
                value: row.loanSchemeId,
                label: `${row.name} (${row.code}) — ${formatBps(row.interestRateBps)}`,
              }))}
              errors={errors.loanSchemeId}
              hint={
                schemesForType.length === 0
                  ? "No active scheme is available for this loan type."
                  : "Only schemes available for new applications are listed."
              }
            />
          </div>

          <SelectField
            name="interest-type"
            label="Interest Type"
            required
            value={interestType}
            onChange={(next) => {
              setInterestType(next);
              setPreview(null);
            }}
            options={INTEREST_TYPE_OPTIONS}
            errors={errors.interestType}
          />

          <Field
            name="rate-percent"
            label="Interest Rate (% a year)"
            required
            inputMode="decimal"
            value={ratePercent}
            onChange={(next) => {
              setRatePercent(next);
              setPreview(null);
            }}
            errors={errors.interestRateBps}
            hint={
              scheme
                ? `Scheme rate is ${formatBps(scheme.interestRateBps)}.`
                : undefined
            }
          />

          <SelectField
            name="frequency-choice"
            label="Frequency"
            required
            value={frequency}
            onChange={(next) => {
              setFrequency(next);
              setDurationCount("");
              setPreview(null);
            }}
            // Only the frequencies this scheme offers, but labelled and ordered
            // by the shared registry rather than by casing the raw value here.
            options={pick(REPAYMENT_FREQUENCY_OPTIONS, frequenciesOffered)}
            errors={errors.repaymentFrequency}
            hint={schemeId ? undefined : "Choose a scheme first."}
          />

          <SelectField
            name="duration-choice"
            label="Duration (periods)"
            required
            value={durationCount}
            onChange={(next) => {
              setDurationCount(next);
              setPreview(null);
            }}
            // Only terms the scheme actually offers, so Scenario 11's
            // unsupported combination cannot be assembled in the first place.
            options={durationsOffered.map((count) => ({
              value: String(count),
              label: String(count),
            }))}
            errors={errors.durationCount}
            hint={frequency ? undefined : "Choose a frequency first."}
          />

          {rateDiffersFromScheme && (
            <div className="sm:col-span-2">
              <Alert
                variant={
                  interestType === "CUSTOM_RATE" && canOverrideRate
                    ? "info"
                    : "warning"
                }
                title="Rate differs from the scheme"
                message={
                  interestType !== "CUSTOM_RATE"
                    ? "A rate that differs from the scheme requires the Custom Rate interest type."
                    : canOverrideRate
                      ? "This will be recorded as a deliberate override."
                      : "You do not have permission to price away from the scheme. The server will refuse this."
                }
              />
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={previewing}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
            >
              {previewing
                ? "Calculating…"
                : preview
                  ? "Recalculate"
                  : "Calculate EMI"}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Calculated on the server, which is the figure submission is
              checked against.
            </p>
          </div>

          {previewError && (
            <Alert
              variant="error"
              title="No repayment schedule"
              message={previewError}
            />
          )}

          {preview && <EmiSchedulePanel schedule={preview} />}

          {preview && (
            <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
              <h4 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
                Review
              </h4>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Summary label="Customer" value={customer?.fullName ?? "—"} />
                <Summary
                  label="Loan type"
                  value={labelFor(LOAN_TYPE_OPTIONS, loanType)}
                />
                <Summary
                  label="Amount"
                  value={amountPaise ? formatPaise(amountPaise) : "—"}
                />
                <Summary label="Scheme" value={scheme?.name ?? "—"} />
                <Summary
                  label="Interest"
                  value={`${labelFor(INTEREST_TYPE_OPTIONS, interestType)} at ${rateBps ? formatBps(rateBps) : "—"}`}
                />
                <Summary
                  label="Term"
                  value={`${durationCount} × ${frequency.toLowerCase()}`}
                />
                <div className="sm:col-span-2">
                  <Summary label="Purpose" value={composedPurpose || "—"} />
                </div>
              </dl>
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Creating the draft opens the application, where documents are
            attached and the final validation summary is shown before
            submission.
          </p>
        </section>
      )}

      <div className="flex items-center justify-between border-t border-gray-200 pt-5 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
        >
          Back
        </button>

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((current) => current + 1)}
            disabled={!stepComplete[step]}
            className="bg-brand-500 shadow-theme-xs hover:bg-brand-600 inline-flex items-center justify-center rounded-lg px-4 py-3 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        ) : (
          <SubmitButton label="Create Draft" pendingLabel="Creating…" />
        )}
      </div>
    </form>
  );
}

function Stepper({
  current,
  completed,
}: {
  current: number;
  completed: boolean[];
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Application steps">
      {STEPS.map((label, index) => {
        const done = completed[index] && index < current;
        const active = index === current;

        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={[
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              active
                ? "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 font-medium"
                : done
                  ? "text-success-600 dark:text-success-500"
                  : "text-gray-500 dark:text-gray-400",
            ].join(" ")}
          >
            <span aria-hidden="true">{done ? "✓" : index + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}

/** Local basis-points formatter for the prefill, which needs a bare number. */
function bps(value: string): string {
  if (!/^\d+$/.test(value)) return "";
  const padded = value.padStart(3, "0");

  return `${padded.slice(0, -2)}.${padded.slice(-2)}`.replace(/\.?0+$/, "");
}
