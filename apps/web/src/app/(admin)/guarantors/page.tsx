import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { GuarantorDirectory, fetchGuarantors } from "@/features/guarantors";

export const metadata: Metadata = {
  title: "Guarantors",
};

export const dynamic = "force-dynamic";

/**
 * The guarantor directory (Module 05, GUA-001, Scenario 1).
 *
 * Gated on `customers.guarantors.view` — a permission that existed before this
 * module and was never reachable from any screen, because guarantors lived only
 * as a tab inside a customer profile. This is the surface it was always
 * describing.
 *
 * The search term and filters come from the URL so a result set is linkable and
 * survives a refresh. They are passed to the API rather than applied here: the
 * server decides which guarantors the caller may see, and filtering a list the
 * client already holds would mean the out-of-scope rows had already been sent.
 */
export default async function GuarantorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    kycStatus?: string;
    consentStatus?: string;
    customerId?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.CUSTOMERS_GUARANTORS_VIEW);
  const params = await searchParams;

  const result = await fetchGuarantors({
    search: params.search,
    status: params.status as never,
    kycStatus: params.kycStatus as never,
    consentStatus: params.consentStatus as never,
    customerId: params.customerId,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Guarantors" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <GuarantorDirectory
          guarantors={result.status === "ok" ? result.guarantors : []}
          loadError={result.status !== "ok"}
          initialSearch={params.search ?? ""}
        />
      </div>
    </div>
  );
}
