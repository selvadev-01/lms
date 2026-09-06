import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchLoanScheme, LoanSchemeDetail } from "@/features/loans";

export const metadata: Metadata = {
  title: "Loan Scheme",
};

export const dynamic = "force-dynamic";

/**
 * One scheme and its duration options (Module 06).
 *
 * `LoanSchemeList` has linked here since it was written, but the route did not
 * exist — so the link 404'd and duration options could only be added through the
 * API directly or a seed script. That gap was not cosmetic: a scheme with no
 * active duration row is excluded by the `selectable` filter, so it is invisible
 * to the application wizard, and the wizard offers only frequencies some scheme
 * carries a term for. Without this screen a new repayment frequency or a longer
 * term could not be introduced through the product at all.
 *
 * `notFound()` on anything but a clean read, following the application detail
 * page: `fetchLoanScheme` collapses a 403 into `not-found`, so another tenant's
 * scheme renders exactly as one that does not exist rather than confirming its
 * id by the shape of the refusal.
 *
 * A Branch Admin reaches this screen — they hold `loans.schemes.view` and need
 * to see what the organization offers — and is refused every write. The API
 * enforces that; `canManage` only avoids presenting forms that are certain to be
 * refused.
 */
export default async function LoanSchemePage({
  params,
}: {
  params: Promise<{ schemeId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.LOANS_SCHEMES_VIEW);
  const { schemeId } = await params;

  const result = await fetchLoanScheme(schemeId);

  if (result.status !== "ok") notFound();

  return (
    <div>
      <PageBreadcrumb pageTitle="Loan Scheme" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <LoanSchemeDetail
          scheme={result.scheme}
          canManage={hasPermissions(user, PERMISSIONS.LOANS_SCHEMES_MANAGE)}
        />
      </div>
    </div>
  );
}
