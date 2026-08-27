import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { FieldCollectionList, fetchFieldCollections } from "@/features/field";

export const metadata: Metadata = {
  title: "Field Collections",
};

export const dynamic = "force-dynamic";

/**
 * Field collections within the caller's scope (Module 12, Scenarios 1, 2).
 *
 * Every filter is passed to the API rather than applied here: the server
 * decides which rows the caller may see, and filtering a list the client
 * already holds would mean the out-of-scope rows had already been sent.
 *
 * There is no branch control and no agent control, here or in the API. Both
 * confinements are applied server-side, which is what makes Scenarios 1, 2 and
 * 48 structural rather than checks somebody has to remember.
 */
export default async function FieldCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    paymentMode?: string;
    gpsCaptureStatus?: string;
    awaitingHandover?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.FIELD_COLLECTIONS_VIEW);
  const params = await searchParams;

  const list = await fetchFieldCollections({
    search: params.search,
    status: params.status,
    paymentMode: params.paymentMode,
    gpsCaptureStatus: params.gpsCaptureStatus,
    awaitingHandover: params.awaitingHandover,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Field Collections" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {list.status === "ok" ? (
          <FieldCollectionList collections={list.collections} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load field collections. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
