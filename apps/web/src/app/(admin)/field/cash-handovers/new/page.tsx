import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { CashHandoverForm, fetchCashHandoverReadiness } from "@/features/field";

export const metadata: Metadata = {
  title: "Hand Over Cash",
};

export const dynamic = "force-dynamic";

/**
 * Draft a handover of the agent's own collected cash (Scenario 22).
 *
 * The readiness read is advisory: the same checks run authoritatively inside
 * the create transaction against a re-derived balance. It exists so the form
 * can offer the valid amounts and refuse early with a reason, not so the
 * mutation can trust it.
 */
export default async function NewCashHandoverPage() {
  await requirePermissions(PERMISSIONS.CASH_HANDOVERS_SUBMIT);

  const readiness = await fetchCashHandoverReadiness();

  return (
    <div>
      <PageBreadcrumb pageTitle="Hand Over Cash" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {readiness.status === "ok" ? (
          <CashHandoverForm readiness={readiness.readiness} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not work out how much cash you are holding. Please try
            again — no handover has been created.
          </p>
        )}
      </div>
    </div>
  );
}
