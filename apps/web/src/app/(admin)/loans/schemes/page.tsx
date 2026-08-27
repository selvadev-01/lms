import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  fetchLoanProducts,
  fetchLoanSchemes,
  LoanSchemeList,
} from "@/features/loans";

export const metadata: Metadata = {
  title: "Loan Schemes",
};

export const dynamic = "force-dynamic";

/**
 * Loan schemes (Module 06).
 *
 * Products are read alongside so the create form can offer a parent and the
 * table can name one. Two reads rather than an embedded list, because the scheme
 * list is the primary content here and the products are a lookup.
 */
export default async function LoanSchemesPage() {
  const user = await requirePermissions(PERMISSIONS.LOANS_SCHEMES_VIEW);

  const [schemeResult, productResult] = await Promise.all([
    fetchLoanSchemes(),
    fetchLoanProducts(),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Loan Schemes" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <LoanSchemeList
          schemes={schemeResult.status === "ok" ? schemeResult.schemes : []}
          products={productResult.status === "ok" ? productResult.products : []}
          loadError={schemeResult.status !== "ok"}
          canManage={hasPermissions(user, PERMISSIONS.LOANS_SCHEMES_MANAGE)}
        />
      </div>
    </div>
  );
}
