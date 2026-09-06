import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { redirect } from "next/navigation";

import PageShell from "@/components/layout/PageShell";
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

  // A 401 here means the session is no longer good — the account was
  // deactivated, or a role was withdrawn, since the page shell rendered.
  // Collapsing it into `loadError` would show "we could not load customers" to
  // someone who is actually signed out, and leave them clicking Refresh.
  if (result.status === "unauthenticated") redirect("/signin");

  return (
    <PageShell
      title="Customer Management"
      description="Search customers, review KYC status and open a profile."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Customers" }]}
    >
      <CustomerList
        customers={result.status === "ok" ? result.customers : []}
        loadError={result.status !== "ok"}
        canCreate={hasPermissions(user, PERMISSIONS.CUSTOMERS_CREATE)}
        initialSearch={params.search ?? ""}
      />
    </PageShell>
  );
}
