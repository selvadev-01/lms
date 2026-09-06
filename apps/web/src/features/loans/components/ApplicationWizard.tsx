"use client";

import type {
  CustomerSummary,
  EmiScheduleView,
  LoanSchemeSummary,
} from "@lms/types";
import {
  addPeriods,
  formatIsoDate,
  todayInKolkata,
  type EmiFrequency,
} from "@lms/emi";
import { Alert, Button, Stepper } from "@lms/ui";
import {
  INTEREST_TYPE_OPTIONS,
  LOAN_APPLICATION_STEPS,
  REPAYMENT_FREQUENCY_OPTIONS,
  labelFor,
  loanApplicationStepSchemas,
  pick,
  type SelectOption,
} from "@lms/validation";
import Link from "next/link";
import React, {
  useActionState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { createApplicationAction } from "../actions/loan-application-actions";
import { readWizardDraft, useWizardDraft } from "../hooks/use-wizard-draft";
import { useWizardStep } from "../hooks/use-wizard-step";
import {
  Field,
  percentToBps,
  rupeesToPaise,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "./FormParts";
import EmiSchedulePanel from "./EmiSchedulePanel";
import { formatBps, formatDate, formatPaise } from "./LoanBadges";

/**
 * `useLayoutEffect` that does not warn during server rendering.
 *
 * This is a client component, but Next still renders it on the server, where
 * layout effects never run and React logs a warning for calling the hook at
 * all. Picking the hook once at module scope — not per render — keeps the call
 * order stable, which is what the rules of hooks actually require.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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
 * 5 and 6.
 *
 * # Where the half-finished application lives
 *
 * The step is a `?step=` slug in the URL and the answers are in sessionStorage,
 * so a refresh, a browser Back, or a shared link all behave like ordinary
 * navigation. Both used to be component state, which meant every screen had the
 * same address and a reload silently discarded everything typed.
 *
 * That is as far as it goes: still no draft row, per D-APP-1 above, so closing
 * the tab does lose the work. See `use-wizard-draft.ts` for why sessionStorage
 * and not localStorage, and `use-wizard-step.ts` for why a query param and not
 * a route segment.
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
    Array<{
      frequency: string;
      durationCount: number;
      /**
       * When set, this term accepts any count between the two and
       * `durationCount` is only the default — so step 3 asks for a number
       * rather than offering a list. Daily loans are stated as dates, so the
       * count is whatever those dates imply.
       */
      minDurationCount: number | null;
      maxDurationCount: number | null;
    }>
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
  /**
   * From the LOAN_TYPE master-data list.
   *
   * Passed in rather than imported from `@lms/validation`, because loan types
   * are admin-managed per tenant now: a compiled-in list would silently fail to
   * offer a type the organization defined for itself.
   */
  loanTypeOptions: SelectOption[];
}

export default function ApplicationWizard({
  customers,
  schemes,
  schemeTerms,
  schemeTypes,
  canOverrideRate,
  purposeOptions,
  loanTypeOptions: offeredLoanTypes,
}: Props) {
  // The step lives in the URL, so Back, Forward, refresh and a shared link all
  // behave like ordinary navigation. See `useWizardStep` for why it is a query
  // param rather than a route segment.
  const { index: step, goTo, redirectTo, hrefFor } = useWizardStep();
  const { save, clear } = useWizardDraft();
  const [state, formAction] = useActionState(createApplicationAction, {});

  // Read from sessionStorage in a lazy initializer rather than an effect, so
  // there is no cascading second render on the common path.
  //
  // WHY the values are not used as the initial state: this is a client
  // component, but Next still server-renders it, and hydration replays that
  // first render in the browser. A lazy initializer runs during exactly that
  // render, so seeding fields from the draft makes the client's tree disagree
  // with the server HTML — which surfaced as a real mismatch on the Stepper,
  // whose step one was an `upcoming` <span> on the server and a `complete`
  // <a> on the client. Fields therefore start empty, matching the server, and
  // `applyDraft` below writes the restored answers in a layout effect.
  const [draft] = useState(readWizardDraft);

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
   * Apply the restored draft, once, after the hydrating render has matched the
   * server's empty fields.
   *
   * `useLayoutEffect` rather than `useEffect` for two reasons. It commits before
   * the browser paints, so a restored wizard is never briefly visible as an
   * empty one. And layout effects run before passive effects, so the answers are
   * in state before the deep-link guard below tests `stepComplete` — with a
   * passive effect, a link straight to `?step=terms` would be judged against
   * empty fields and bounced back to step one every time.
   *
   * The empty dependency list is deliberate: this restores once, it does not
   * sync. `draft` is frozen in a `useState` initializer and never changes
   * identity, so the exhaustive-deps rule is satisfied without an exception.
   */
  useIsomorphicLayoutEffect(() => {
    if (!draft) return;
    if (draft.customerId) setCustomerId(draft.customerId);
    if (draft.loanType) setLoanType(draft.loanType);
    if (draft.amountRupees) setAmountRupees(draft.amountRupees);
    if (draft.purposeCode) setPurposeCode(draft.purposeCode);
    if (draft.purposeDetail) setPurposeDetail(draft.purposeDetail);
    if (draft.schemeId) setSchemeId(draft.schemeId);
    if (draft.interestType) setInterestType(draft.interestType);
    if (draft.ratePercent) setRatePercent(draft.ratePercent);
    if (draft.frequency) setFrequency(draft.frequency);
    if (draft.durationCount) setDurationCount(draft.durationCount);
  }, []);

  /**
   * Persist every answer, debounced, so a refresh or a Back finds them.
   *
   * `preview` is deliberately never stored: a schedule computed against terms
   * the user has since edited is a wrong number displayed with full
   * confidence, which in a lending system is worse than no number. It is
   * recomputed on demand instead.
   */
  useEffect(() => {
    save({
      customerId,
      loanType,
      amountRupees,
      purposeCode,
      purposeDetail,
      schemeId,
      interestType,
      ratePercent,
      frequency,
      durationCount,
    });
  }, [
    save,
    customerId,
    loanType,
    amountRupees,
    purposeCode,
    purposeDetail,
    schemeId,
    interestType,
    ratePercent,
    frequency,
    durationCount,
  ]);

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

  /**
   * A scheme is only offerable if it also has terms to borrow over.
   *
   * `selectable=true` already excludes inactive schemes and those under an
   * inactive product, but it does not know whether a scheme has any ACTIVE
   * duration rows. One with none passes every earlier gate, appears in the
   * scheme list, and then leaves Frequency and Duration permanently empty with
   * nothing on screen explaining why — so it is filtered out here instead.
   */
  const offerableSchemes = useMemo(
    () =>
      schemes.filter((row) => (schemeTerms[row.loanSchemeId] ?? []).length > 0),
    [schemes, schemeTerms],
  );

  /** Only schemes under a product of the chosen type (Rule 12, step 2). */
  const schemesForType = useMemo(
    () =>
      loanType
        ? offerableSchemes.filter(
            (row) => schemeTypes[row.loanSchemeId] === loanType,
          )
        : offerableSchemes,
    [offerableSchemes, schemeTypes, loanType],
  );

  /**
   * Step 2 offers only the loan types an application can actually be completed
   * for.
   *
   * The tenant's `LOAN_TYPE` list is the starting point, but a type with no
   * scheme behind it is still a dead end: the user picks it, reaches step 3, and
   * is told no scheme exists — having already answered amount and purpose. So
   * the list is narrowed to types some offerable scheme actually belongs to.
   *
   * A type already chosen is kept even if it has no schemes, so a restored draft
   * or a scheme withdrawn mid-application does not silently blank the field the
   * user is looking at.
   */
  const loanTypeOptions = useMemo(() => {
    const offered = new Set(
      offerableSchemes.map((row) => schemeTypes[row.loanSchemeId]),
    );
    return offeredLoanTypes.filter(
      (option) => offered.has(option.value) || option.value === loanType,
    );
  }, [offeredLoanTypes, offerableSchemes, schemeTypes, loanType]);

  const terms = schemeId ? (schemeTerms[schemeId] ?? []) : [];
  const frequenciesOffered = [...new Set(terms.map((term) => term.frequency))];
  const termsForFrequency = terms.filter(
    (term) => term.frequency === frequency,
  );
  const durationsOffered = termsForFrequency
    .map((term) => term.durationCount)
    .sort((a, b) => a - b);

  /**
   * The ranged term for this frequency, if the scheme publishes one.
   *
   * Its presence is what switches step 3 from a picklist to a number: a daily
   * loan is agreed as "until this date", so the count is whatever the dates
   * imply and cannot come from a list. Weekly and monthly keep the list, where
   * the handful of published terms *is* the lender's offer.
   *
   * A scheme mixing a range and fixed rows at one frequency would be odd, so the
   * first range wins rather than trying to merge them.
   */
  const rangedTerm = termsForFrequency.find(
    (term) => term.minDurationCount !== null && term.maxDurationCount !== null,
  );

  /**
   * The last due date the chosen count implies.
   *
   * Computed with the same `addPeriods` the schedule generator uses, so the date
   * shown here cannot disagree with the dates the loan is actually built from.
   * Display only — the stored value is still the count.
   */
  const isRanged = rangedTerm !== undefined;
  const endDate = useMemo(() => {
    const count = Number(durationCount);
    if (!isRanged || !frequency || !Number.isInteger(count) || count < 1) {
      return null;
    }

    try {
      return formatIsoDate(
        addPeriods(todayInKolkata(), frequency as EmiFrequency, count),
      );
    } catch {
      // An unsupported frequency throws rather than returning a wrong date.
      return null;
    }
    // `isRanged`, not `rangedTerm`: only its presence matters here, and the
    // object identity changes on every render.
  }, [isRanged, frequency, durationCount]);

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

  /**
   * What each step needs before Next means anything.
   *
   * The first three come from `loanApplicationStepSchemas`, which are `.pick()`
   * slices of the very schema the server action validates on submit. That is
   * the point: a bound changed in one place moves the Next gate and the server
   * check together. These used to be hand-written booleans that restated the
   * rules and could drift from them silently — the client would wave a value
   * through and the server would reject it with an error pointing at a field
   * the user had already filled in.
   *
   * `loanType` and `purposeCode` are UI-only (they compose into `purpose` and
   * pick the scheme list), so they stay hand-checked; no schema owns them.
   */
  const stepComplete = [
    loanApplicationStepSchemas.customer.safeParse({ customerId }).success,
    Boolean(loanType && purposeCode) &&
      loanApplicationStepSchemas.details.safeParse({
        requestedAmountPaise: amountPaise,
        purpose: composedPurpose,
      }).success,
    loanApplicationStepSchemas.terms.safeParse({
      loanSchemeId: schemeId,
      interestType,
      interestRateBps: rateBps,
      repaymentFrequency: frequency,
      durationCount,
    }).success,
    // Step 4 gates on the preview having actually resolved: an EMI that does not
    // compute blocks submission anyway (Scenario 12), so letting the user past
    // this point would only defer the refusal.
    preview !== null,
  ];

  /**
   * A deep link into a step the answers do not support falls back to the first
   * unanswered one.
   *
   * Someone can paste `?step=preview` into a fresh tab, or return to a link
   * after the draft expired with the tab. Rendering step four over empty state
   * would show a Create button that could only fail, so we walk them to the
   * earliest step that still needs an answer instead. `replace`, so Back does
   * not return to the impossible step.
   */
  useEffect(() => {
    const firstIncomplete = stepComplete.findIndex((done) => !done);
    if (firstIncomplete !== -1 && step > firstIncomplete) {
      redirectTo(LOAN_APPLICATION_STEPS[firstIncomplete]);
    }
    // `stepComplete` is derived from field state this effect never sets, so
    // depending on the step alone is sufficient and avoids re-running the
    // check on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
    <form
      action={formAction}
      // Cleared here rather than after the action returns, because a successful
      // create `redirect`s and no state comes back to react to. Clearing on
      // submit is safe: if the create fails, the user stays on this page with
      // every field still in component state, and the next keystroke rewrites
      // the draft.
      onSubmit={() => clear()}
      className="space-y-6"
    >
      <Stepper
        label="Application steps"
        linkComponent={Link}
        steps={STEPS.map((label, index) => ({
          label,
          status:
            index === step
              ? ("current" as const)
              : stepComplete[index]
                ? ("complete" as const)
                : ("upcoming" as const),
          // Only a completed earlier step is a link. Linking ahead would let
          // someone jump to a step whose prerequisites are unanswered, which
          // the deep-link guard would immediately bounce them back from.
          href:
            index < step && stepComplete[index]
              ? hrefFor(LOAN_APPLICATION_STEPS[index])
              : undefined,
        }))}
      />

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
                <Button type="button" size="sm" variant="outline">
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
            options={loanTypeOptions}
            hint={
              loanTypeOptions.length === 0
                ? "No loan schemes are configured yet, so an application cannot be started."
                : undefined
            }
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

          {rangedTerm ? (
            /* A term the borrower states rather than picks. The scheme bounds
               it, so an out-of-range count is still refused — by the input, and
               again by the submit gate, which is the authoritative one. */
            <Field
              name="duration-choice"
              label="Duration (periods)"
              required
              inputMode="numeric"
              value={durationCount}
              onChange={(next) => {
                setDurationCount(next);
                setPreview(null);
              }}
              placeholder={String(rangedTerm.durationCount)}
              errors={errors.durationCount}
              hint={
                endDate
                  ? `${durationCount} ${frequency.toLowerCase()} periods — ends ${formatDate(endDate)}`
                  : `Any number between ${rangedTerm.minDurationCount} and ${rangedTerm.maxDurationCount}.`
              }
            />
          ) : (
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
          )}

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
                  value={labelFor(offeredLoanTypes, loanType)}
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
        <Button
          type="button"
          variant="secondary"
          onClick={() => goTo(LOAN_APPLICATION_STEPS[Math.max(0, step - 1)])}
          disabled={step === 0}
        >
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => goTo(LOAN_APPLICATION_STEPS[step + 1])}
            disabled={!stepComplete[step]}
          >
            Next
          </Button>
        ) : (
          <SubmitButton label="Create Draft" pendingLabel="Creating…" />
        )}
      </div>
    </form>
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
