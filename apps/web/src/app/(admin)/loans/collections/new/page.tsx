import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { CollectForm, fetchCollectionReadiness } from "@/features/collections";

export const metadata: Metadata = {
  title: "Collect EMI",
};

export const dynamic = "force-dynamic";

/**
 * Take a payment against a loan (Module 11, Scenarios 5-12).
 *
 * The loan is named in the query string rather than the path because a
 * collection belongs to a loan but is not nested under one in the URL — the
 * collection's own route is `/loans/collections/:id`, and a
 * `/loans/:loanId/collections/new` path would imply a hierarchy the API does
 * not have.
 *
 * Readiness is fetched here rather than inside the form so the page can refuse
 * before rendering an input: a form for a loan that cannot take money is worse
 * than no form, because the operator fills it in before being told.
 */
export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ loanId?: string }>;
}) {
  await requirePermissions(PERMISSIONS.COLLECTIONS_POST);
  const params = await searchParams;

  if (!params.loanId) notFound();

  const readiness = await fetchCollectionReadiness(params.loanId);

  // Out of scope, another tenant, or absent — deliberately indistinguishable.
  if (readiness.status === "not-found") notFound();

  if (readiness.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Collect EMI" />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            We could not load this loan. Please try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="Collect EMI" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <CollectForm readiness={readiness.readiness} />
      </div>
    </div>
  );
}
