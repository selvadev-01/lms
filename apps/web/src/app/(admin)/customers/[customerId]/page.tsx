import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { CustomerProfile, fetchCustomerProfile } from "@/features/customers";
import { fetchMasterDataOptions } from "@/features/master-data";

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

  // The two option lists are fetched alongside the profile rather than after
  // it: neither depends on the profile, and serialising three reads would add
  // two round trips to a screen that already waits on one.
  const [result, genderOptions, relationshipOptions] = await Promise.all([
    fetchCustomerProfile(customerId),
    fetchMasterDataOptions("GENDER"),
    fetchMasterDataOptions("RELATIONSHIP"),
  ]);
  if (result.status === "not-found") notFound();

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
