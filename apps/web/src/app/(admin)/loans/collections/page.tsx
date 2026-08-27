import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { CollectionList, fetchCollections } from "@/features/collections";

export const metadata: Metadata = {
  title: "EMI Collection",
};

export const dynamic = "force-dynamic";

/**
 * The collection list (Module 11, Scenarios 1, 4).
 *
 * Search, status and date range come from the URL so a result set is linkable
 * and survives a refresh, and all of them are passed to the API rather than
 * applied here: the server decides which rows the caller may see, and filtering
 * a list the client already holds would mean the out-of-scope rows had already
 * been sent.
 *
 * There is no branch control, here or in the API. That absence is what makes
 * Scenario 1 structural rather than a check somebody has to remember.
 */
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.COLLECTIONS_VIEW);
  const params = await searchParams;

  const list = await fetchCollections({
    search: params.search,
    status: params.status,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="EMI Collection" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {list.status === "ok" ? (
          <CollectionList collections={list.collections} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load collections. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
