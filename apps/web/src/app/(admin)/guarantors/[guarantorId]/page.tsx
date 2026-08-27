import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { GuarantorDetail, fetchGuarantorProfile } from "@/features/guarantors";

export const metadata: Metadata = {
  title: "Guarantor",
};

export const dynamic = "force-dynamic";

/**
 * Guarantor detail (Module 05, GUA-002, Scenarios 2, 5).
 *
 * `fetchGuarantorProfile` collapses a 403 into `not-found`, so an out-of-scope
 * guarantor renders the 404 page rather than a "forbidden" that would confirm
 * the id exists — which is precisely the disclosure Scenario 5 guards against.
 *
 * Every capability is resolved here and passed down. The components never read
 * permissions themselves: a client component deciding its own authority would be
 * deciding it in the browser, where the answer can be edited.
 */
export default async function GuarantorDetailPage({
  params,
}: {
  params: Promise<{ guarantorId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CUSTOMERS_GUARANTORS_VIEW);
  const { guarantorId } = await params;

  const result = await fetchGuarantorProfile(guarantorId);
  if (result.status === "not-found") notFound();

  if (result.status !== "ok") {
    // Distinct from not-found on purpose: "we cannot reach this guarantor" is a
    // different claim from "this guarantor does not exist".
    throw new Error("Guarantor unavailable");
  }

  return (
    <div>
      <PageBreadcrumb pageTitle="Guarantor" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <GuarantorDetail
          profile={result.profile}
          canDeactivate={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_DEACTIVATE,
          )}
          canUpload={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_DOCUMENTS_UPLOAD,
          )}
          canVerifyDocuments={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_DOCUMENTS_VERIFY,
          )}
          canSubmitKyc={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_MANAGE,
          )}
          canReviewKyc={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_KYC_REVIEW,
          )}
          canDownload={hasPermissions(
            user,
            PERMISSIONS.CUSTOMERS_GUARANTORS_DOCUMENTS_DOWNLOAD,
          )}
        />
      </div>
    </div>
  );
}
