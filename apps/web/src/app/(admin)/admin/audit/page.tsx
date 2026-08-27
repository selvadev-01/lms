import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  AuditFilterBar,
  AuditTable,
  auditExportHref,
  fetchAuditEvents,
} from "@/features/audit";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";

export const metadata: Metadata = {
  title: "Audit Trail",
};

export const dynamic = "force-dynamic";

/**
 * The audit trail (Scenarios 36-38, 41-42).
 *
 * Gated on `audit.view`, which a Branch Admin holds — confined server-side to
 * their own branch's events plus those with no branch attribution authored in
 * it. Export is a separate permission they do NOT hold, so the button is absent
 * for them and the endpoint refuses it regardless (Scenario 42).
 *
 * Filters live in the URL. That is not only the server-component convention: an
 * auditor citing what they reviewed needs a link that reproduces it.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    entityType?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.AUDIT_VIEW);
  const params = await searchParams;

  const filters = {
    action: params.action,
    entityType: params.entityType,
    from: params.from,
    to: params.to,
    page: params.page ? Number(params.page) : undefined,
  };

  const events = await fetchAuditEvents(filters);

  return (
    <div>
      <PageBreadcrumb pageTitle="Audit Trail" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <AuditFilterBar
          filters={filters}
          exportHref={auditExportHref(filters)}
          canExport={hasPermissions(user, PERMISSIONS.AUDIT_EXPORT)}
        />

        <AuditTable
          result={events.status === "ok" ? events.result : null}
          loadError={events.status !== "ok"}
        />
      </div>
    </div>
  );
}
