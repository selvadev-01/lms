import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { CustomerForm } from "@/features/customers";
import { fetchMasterDataOptions } from "@/features/master-data";
import { fetchBranches } from "@/features/organizations";

export const metadata: Metadata = {
  title: "Add Customer",
};

export const dynamic = "force-dynamic";

/**
 * Customer registration (Module 04, Scenarios 1-5).
 *
 * The branch picker is offered only to a caller with no branch of their own. A
 * branch-scoped user has theirs applied server-side and is never shown the
 * field — which is Scenario 31 expressed as an absent control rather than a
 * rejected value. Only ACTIVE branches are offered, because an inactive one
 * cannot take a new customer (Rules 47/50).
 */
export default async function NewCustomerPage() {
  const user = await requirePermissions(PERMISSIONS.CUSTOMERS_CREATE);
  const needsBranch = !user.branchId;

  // Fetched together rather than in sequence: neither depends on the other, and
  // the gender list is a small read that should not add a round trip.
  const [branches, genderOptions] = await Promise.all([
    needsBranch ? fetchBranches({ activeOnly: true }) : null,
    fetchMasterDataOptions("GENDER"),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Add Customer" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <CustomerForm
          needsBranch={needsBranch}
          genderOptions={genderOptions}
          branches={
            branches?.status === "ok"
              ? branches.branches.map((branch) => ({
                  branchId: branch.branchId,
                  name: branch.name,
                }))
              : []
          }
        />
      </div>
    </div>
  );
}
