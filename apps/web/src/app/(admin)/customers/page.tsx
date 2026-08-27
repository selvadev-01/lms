import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { CustomerList, fetchCustomers } from "@/features/customers";

export const metadata: Metadata = {
  title: "Customer Management",
};

export const dynamic = "force-dynamic";

/**
 * Customer Management — the Branch Admin flow's "Customer Search" entry point
 * (Module 04, Scenarios 18-21).
 *
 * The search term comes from the URL so a result set is linkable and survives a
 * refresh. It is passed to the API rather than filtered here: the server decides
 * which customers the caller may see, and filtering a list the client already
 * holds would mean the out-of-scope rows had already been sent.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    customerType?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CUSTOMERS_VIEW);
  const params = await searchParams;

  const result = await fetchCustomers({
    search: params.search,
    status: params.status as never,
    customerType: params.customerType as never,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Customer Management" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <CustomerList
          customers={result.status === "ok" ? result.customers : []}
          loadError={result.status !== "ok"}
          canCreate={hasPermissions(user, PERMISSIONS.CUSTOMERS_CREATE)}
          initialSearch={params.search ?? ""}
        />
      </div>
    </div>
  );
}
