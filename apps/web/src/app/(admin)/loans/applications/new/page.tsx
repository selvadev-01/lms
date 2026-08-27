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

  const [customerResult, schemeResult, purposeOptions] = await Promise.all([
    fetchCustomers({ status: "ACTIVE" }),
    fetchLoanSchemes({ selectable: true }),
    fetchMasterDataOptions("LOAN_PURPOSE"),
  ]);

  const schemes = schemeResult.status === "ok" ? schemeResult.schemes : [];

  const details = await Promise.all(
    schemes.map((scheme) => fetchLoanScheme(scheme.loanSchemeId)),
  );

  const schemeTerms: Record<
    string,
    Array<{ frequency: string; durationCount: number }>
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
      }));
    schemeTypes[detail.scheme.loanSchemeId] = detail.scheme.loanType;
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="New Loan Application" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <ApplicationWizard
          customers={
            customerResult.status === "ok" ? customerResult.customers : []
          }
          schemes={schemes}
          purposeOptions={purposeOptions}
          schemeTerms={schemeTerms}
          schemeTypes={schemeTypes}
          canOverrideRate={hasPermissions(
            user,
            PERMISSIONS.LOANS_APPLICATIONS_OVERRIDE_RATE,
          )}
        />
      </div>
    </div>
  );
}
