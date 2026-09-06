import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchCustomers } from "@/features/customers";
import { fetchMasterDataOptions } from "@/features/master-data";
import {
  ApplicationWizard,
  fetchLoanScheme,
  fetchLoanSchemes,
} from "@/features/loans";

export const metadata: Metadata = {
  title: "New Loan Application",
};

export const dynamic = "force-dynamic";

/**
 * The application wizard's entry point (Scenarios 5, 6).
 *
 * Two reads happen here rather than in the browser: an opening set of customers
 * the caller may reach, and the schemes an application may actually be created
 * against. Both are scope-filtered by the API, so the wizard renders only what
 * this user could legitimately choose.
 *
 * The customers are only what step 1 shows *before* the user types. Searching
 * goes to `/api/customers/search`, because the browser must not be the thing
 * deciding which customers match — on a large tenant that means shipping the
 * whole active-customer set and still failing to find anyone past the display
 * cap (Rule 19).
 *
 * The schemes are then read a second time, individually, for their duration
 * options. `selectable=true` returns summaries without them, and the wizard's
 * step 3 needs the exact frequency/duration pairs each scheme offers so an
 * unsupported combination cannot be assembled at all (Scenario 11). The reads
 * run concurrently and there are only ever a handful of active schemes.
 */
export default async function NewLoanApplicationPage() {
  const user = await requirePermissions(PERMISSIONS.LOANS_APPLICATIONS_CREATE);

  const [customerResult, schemeResult, purposeOptions, loanTypeOptions] =
    await Promise.all([
      fetchCustomers({ status: "ACTIVE" }),
      fetchLoanSchemes({ selectable: true }),
      fetchMasterDataOptions("LOAN_PURPOSE"),
      // Loan types are admin-managed per tenant, so the labels come from the
      // API rather than the compiled-in registry — an organization that added
      // its own type would otherwise find it unofferable here.
      fetchMasterDataOptions("LOAN_TYPE"),
    ]);

  const schemes = schemeResult.status === "ok" ? schemeResult.schemes : [];

  const details = await Promise.all(
    schemes.map((scheme) => fetchLoanScheme(scheme.loanSchemeId)),
  );

  const schemeTerms: Record<
    string,
    Array<{
      frequency: string;
      durationCount: number;
      minDurationCount: number | null;
      maxDurationCount: number | null;
    }>
  > = {};
  const schemeTypes: Record<string, string> = {};

  for (const detail of details) {
    if (detail.status !== "ok") continue;

    schemeTerms[detail.scheme.loanSchemeId] = detail.scheme.durations
      // Only active options: an inactive one exists but cannot be borrowed over.
      .filter((duration) => duration.status === "ACTIVE")
      .map((duration) => ({
        frequency: duration.frequency,
        durationCount: duration.durationCount,
        // Carried so step 3 knows whether this term is a fixed choice or a
        // range the borrower states — a daily loan runs to a date.
        minDurationCount: duration.minDurationCount,
        maxDurationCount: duration.maxDurationCount,
      }));
    schemeTypes[detail.scheme.loanSchemeId] = detail.scheme.loanType;
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="New Loan Application" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {/* Schemes are load-bearing here in a way the other selectors are not:
            every downstream term and type above is keyed off them, so a failed
            load empties the wizard rather than merely narrowing it. Rendering
            it anyway would present an application that cannot be completed and
            would misreport a denial or an outage as "no schemes are offered". */}
        {schemeResult.status !== "ok" ? (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load the loan schemes, so an application cannot be
            started right now. Please try again.
          </p>
        ) : (
          <ApplicationWizard
            customers={
              customerResult.status === "ok" ? customerResult.customers : []
            }
            schemes={schemes}
            purposeOptions={purposeOptions}
            loanTypeOptions={loanTypeOptions}
            schemeTerms={schemeTerms}
            schemeTypes={schemeTypes}
            canOverrideRate={hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_OVERRIDE_RATE,
            )}
          />
        )}
      </div>
    </div>
  );
}
