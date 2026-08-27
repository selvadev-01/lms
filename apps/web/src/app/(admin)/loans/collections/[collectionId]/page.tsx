import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  CollectionDetail,
  fetchCollection,
  fetchCollectionLedger,
} from "@/features/collections";

export const metadata: Metadata = {
  title: "Collection",
};

export const dynamic = "force-dynamic";

/**
 * Collection detail (Module 11, Scenarios 2, 3, 25, 27, 31).
 *
 * Two reads in parallel. The ledger legitimately 404s for a collection that is
 * not posted, so it is degraded to `null` rather than failing the page.
 *
 * # Capabilities
 *
 * Resolved here from the session and passed down, so the component never
 * decides authority for itself. This is presentation only — the API refuses
 * regardless of what is rendered, which is what Scenario 36 asserts. A Branch
 * Admin sees this page and its allocation and ledger panels, and does not see
 * Reverse; calling the endpoint directly still returns 403.
 */
export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.COLLECTIONS_VIEW);
  const { collectionId } = await params;

  const [detail, ledger] = await Promise.all([
    fetchCollection(collectionId),
    fetchCollectionLedger(collectionId),
  ]);

  // Out of scope, another tenant, or absent — deliberately indistinguishable.
  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load collection");

  return (
    <div>
      <PageBreadcrumb pageTitle="Collection" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <CollectionDetail
          collection={detail.collection}
          ledger={ledger.status === "ok" ? ledger.entry : null}
          capabilities={{
            canReverse: hasPermissions(user, PERMISSIONS.COLLECTIONS_REVERSE),
          }}
        />
      </div>
    </div>
  );
}
