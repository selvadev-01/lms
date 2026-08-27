import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { FieldCollectionDetail, fetchFieldCollection } from "@/features/field";

export const metadata: Metadata = {
  title: "Field Collection",
};

export const dynamic = "force-dynamic";

/**
 * One field collection in full (Scenario 3).
 *
 * `not-found` covers four cases at once — absent, another branch's, another
 * agent's, another tenant's — and they are deliberately indistinguishable. A
 * 403 would confirm the id exists somewhere the caller cannot reach, which is
 * the information the scope exists to withhold (Scenarios 45, 47).
 *
 * Per-action authority is resolved here, server-side, and passed down as
 * capabilities. Components never test permissions themselves.
 */
export default async function FieldCollectionPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.FIELD_COLLECTIONS_VIEW);
  const { collectionId } = await params;

  const detail = await fetchFieldCollection(collectionId);

  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load collection");

  return (
    <div>
      <PageBreadcrumb pageTitle="Field Collection" />

      <FieldCollectionDetail
        collection={detail.collection}
        capabilities={{
          canVerify: hasPermissions(user, PERMISSIONS.FIELD_COLLECTIONS_VERIFY),
        }}
      />
    </div>
  );
}
