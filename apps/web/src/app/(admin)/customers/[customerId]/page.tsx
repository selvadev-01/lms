import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { CustomerProfile, fetchCustomerProfile } from "@/features/customers";
import {
  fetchLoanApplications,
  fetchLoans,
  fetchLoanSchedule,
} from "@/features/loans";
import { fetchMasterDataOptions } from "@/features/master-data";
import { fetchPortfolioReport } from "@/features/reports";

/**
 * How many loans get their instalment list rendered on the customer screen.
 *
 * Each one is its own request, so this is the page's round-trip budget. Five
 * covers every real borrower; the outlier it guards against is a fixture with
 * 1,663 loans, where an unbounded fan-out would hang the page.
 */
const SCHEDULES_SHOWN = 5;

export const metadata: Metadata = {
  title: "Customer Profile",
};

export const dynamic = "force-dynamic";

/**
 * The customer profile (Module 04, Scenarios 22-23).
 *
 * `fetchCustomerProfile` collapses a 403 into `not-found`, so an out-of-scope
 * customer renders the 404 page rather than a "forbidden" that would confirm the
 * id exists (Scenarios 19, 21, 30).
 *
 * Every capability is resolved here and passed down. The components never read
 * permissions themselves — a client component deciding its own authority would
 * be deciding it in the browser, where the answer can be edited.
 */
export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CUSTOMERS_VIEW);
  const { customerId } = await params;

  // Gated rather than fetched-and-discarded: a caller without these sees the
  // Loans tab's empty state, which is the truthful answer for someone not
  // entitled to the data.
  const canViewLoans = hasPermissions(user, PERMISSIONS.LOANS_VIEW);
  const canViewApplications = hasPermissions(
    user,
    PERMISSIONS.LOANS_APPLICATIONS_VIEW,
  );
  // The Portfolio report is what carries the outstanding split and days past
  // due. Without it the tab falls back to the plain loan list.
  const canSeeBalances = hasPermissions(
    user,
    PERMISSIONS.REPORTS_PORTFOLIO_VIEW,
  );
  const canSeeSchedules = hasPermissions(
    user,
    PERMISSIONS.LOANS_SCHEDULES_VIEW,
  );

  // The two option lists are fetched alongside the profile rather than after
  // it: neither depends on the profile, and serialising three reads would add
  // two round trips to a screen that already waits on one.
  const [
    result,
    genderOptions,
    relationshipOptions,
    loans,
    applications,
    portfolio,
  ] =
    await Promise.all([
      fetchCustomerProfile(customerId),
      fetchMasterDataOptions("GENDER"),
      fetchMasterDataOptions("RELATIONSHIP"),
      // The Loans tab. Both read the customer's own rows and are scoped
      // server-side, and both degrade to empty rather than failing the page —
      // this screen's subject is the customer, not their borrowing.
      canViewLoans ? fetchLoans({ customerId }) : Promise.resolve([]),
      canViewApplications
        ? fetchLoanApplications({ customerId })
        : Promise.resolve({ status: "ok" as const, applications: [] }),
      // One call for every loan's position, rather than three per loan.
      canSeeBalances
        ? fetchPortfolioReport({ customerId, pageSize: 100 })
        : Promise.resolve({ status: "not-found" as const }),
    ]);
  if (result.status === "not-found") notFound();

  /**
   * The instalments behind each loan, for the Loans tab.
   *
   * Fetched here rather than on expand because the schedule is per loan and
   * there is no customer-wide EMI read — and a typical loan carries 8-12 rows,
   * so a borrower with a handful of loans is a small page.
   *
   * **Bounded deliberately.** A seeded fixture has a customer with 1,663 loans;
   * one request per loan would be 1,663 round trips and the page would never
   * load. The newest few are fetched and the rest of the loans still list their
   * balances, with the tab saying which ones have their schedule shown.
   */
  const scheduleLoanIds = (
    portfolio.status === "ok" ? portfolio.report.rows : []
  )
    .slice(0, SCHEDULES_SHOWN)
    .map((row) => row.loanId);

  const schedules = canSeeSchedules
    ? (await Promise.all(scheduleLoanIds.map((id) => fetchLoanSchedule(id))))
        .filter((schedule): schedule is NonNullable<typeof schedule> =>
          Boolean(schedule),
        )
    : [];

  if (result.status !== "ok") {
    // Distinct from not-found on purpose: "we cannot reach this customer" is a
    // different claim from "this customer does not exist".
    throw new Error("Customer profile unavailable");
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="Customer Profile" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <CustomerProfile
          profile={result.profile}
          loans={loans}
          positions={portfolio.status === "ok" ? portfolio.report.rows : []}
          canSeeBalances={canSeeBalances}
          schedules={schedules}
          applications={
            applications.status === "ok" ? applications.applications : []
          }
          genderOptions={genderOptions}
          relationshipOptions={relationshipOptions}
          canUpdate={hasPermissions(user, PERMISSIONS.CUSTOMERS_UPDATE)}
          canVerifyMobile={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_MOBILE_VERIFY,
          )}
          canActivate={hasPermissions(user, PERMISSIONS.CUSTOMERS_ACTIVATE)}
          canDelete={hasPermissions(user, PERMISSIONS.CUSTOMERS_DELETE)}
          canConvert={hasPermissions(user, PERMISSIONS.CUSTOMERS_CONVERT)}
          canKycView={hasPermissions(user, PERMISSIONS.CUSTOMERS_KYC_VIEW)}
          canKycSubmit={hasPermissions(user, PERMISSIONS.CUSTOMERS_KYC_SUBMIT)}
          canKycApprove={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_KYC_APPROVE,
          )}
          canUpload={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_DOCUMENTS_UPLOAD,
          )}
          canVerifyDocuments={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_DOCUMENTS_VERIFY,
          )}
          canDownload={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_DOCUMENTS_DOWNLOAD,
          )}
          canManageGuarantors={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_MANAGE,
          )}
          canViewGuarantors={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_VIEW,
          )}
          canDeactivateGuarantors={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_DEACTIVATE,
          )}
          canDeleteGuarantors={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_DELETE,
          )}
        />
      </div>
    </div>
  );
}
