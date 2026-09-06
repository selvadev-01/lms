import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchLoanProducts, LoanProductList } from "@/features/loans";
import { fetchMasterDataOptions } from "@/features/master-data";

export const metadata: Metadata = {
  title: "Loan Products",
};

export const dynamic = "force-dynamic";

/**
 * Loan products (Module 06).
 *
 * A Branch Admin reaches this screen — they hold `loans.products.view` and need
 * to see what the organization lends — and is refused every write. That split is
 * deliberate and is not the usual "withhold one grant to prove a denial": the
 * source is explicit that Branch Admin is not a configuration owner.
 */
export default async function LoanProductsPage() {
  const user = await requirePermissions(PERMISSIONS.LOANS_PRODUCTS_VIEW);
  // Loan types are admin-managed master data, so the create form's options come
  // from the tenant's own list rather than a compiled-in enum.
  const [result, loanTypeOptions] = await Promise.all([
    fetchLoanProducts(),
    fetchMasterDataOptions("LOAN_TYPE"),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Loan Products" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <LoanProductList
          products={result.status === "ok" ? result.products : []}
          loanTypeOptions={loanTypeOptions}
          loadError={result.status !== "ok"}
          canManage={hasPermissions(user, PERMISSIONS.LOANS_PRODUCTS_MANAGE)}
        />
      </div>
    </div>
  );
}
