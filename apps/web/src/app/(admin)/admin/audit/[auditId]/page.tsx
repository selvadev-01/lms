import { PERMISSIONS } from "@lms/constants";
import { Badge } from "@lms/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { fetchAuditEvent } from "@/features/audit";
import { requirePermissions } from "@/features/auth/utils/require-permissions";

export const metadata: Metadata = {
  title: "Audit Event",
};

export const dynamic = "force-dynamic";

/**
 * One audit event (Scenarios 37, 39, 43).
 *
 * # There is no action on this page, and that is the point
 *
 * No edit form, no delete button, no menu. Rule 54 says viewing an audit event
 * must not permit modifying it, and an absent affordance is the clearest way to
 * say so — there is nothing here for someone to re-enable later assuming it was
 * merely forgotten. The API exposes no write route and the database refuses
 * UPDATE and DELETE outright; this is the third layer.
 *
 * # Redaction is disclosed
 *
 * Before/after values arrive redacted without `audit.sensitive.view`. The page
 * says so rather than rendering an empty panel, because "you may not see this"
 * and "nothing was recorded" are different facts about the evidence.
 */
export default async function AuditEventPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  await requirePermissions(PERMISSIONS.AUDIT_VIEW);
  const { auditId } = await params;

  const result = await fetchAuditEvent(auditId);
  // 403 and 404 both arrive as `not-found`, which is what stops an id being
  // enumerable across branches (Scenario 46).
  if (result.status === "not-found") notFound();

  if (result.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Audit Event" />
        <p className="text-error-500 text-sm">
          We could not load this audit event. Refresh to try again.
        </p>
      </div>
    );
  }

  const event = result.event;

  return (
    <div>
      <PageBreadcrumb pageTitle="Audit Event" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-gray-500 uppercase">Action</dt>
            <dd className="font-mono text-sm">{event.action}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase">Occurred</dt>
            <dd className="text-sm">
              {new Date(event.occurredAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase">Actor</dt>
            <dd className="text-sm">
              {event.actorName ?? <Badge variant="light">System</Badge>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase">Target</dt>
            <dd className="text-sm">
              {event.entityType}
              {event.entityId ? ` · ${event.entityId}` : ""}
            </dd>
          </div>
        </dl>

        {event.isRedacted ? (
          <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            Before and after values are restricted. They were recorded and are
            preserved; your role does not include permission to read them.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs text-gray-500 uppercase">Before</h3>
              <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
                {JSON.stringify(event.oldData ?? null, null, 2)}
              </pre>
            </div>
            <div>
              <h3 className="mb-1 text-xs text-gray-500 uppercase">After</h3>
              <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
                {JSON.stringify(event.newData ?? null, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Audit records cannot be edited or deleted.
        </p>
      </div>
    </div>
  );
}
