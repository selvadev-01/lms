import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  JournalActions,
  JournalDetailPanel,
  fetchJournal,
} from "@/features/accounting";

export const metadata: Metadata = {
  title: "Journal Entry",
};

export const dynamic = "force-dynamic";

/**
 * Journal detail (Module 14, Scenarios 33, 36, 37, 39).
 *
 * # Capabilities
 *
 * Resolved here from the session and passed down, so the component never
 * decides authority for itself. This is presentation only — the API refuses
 * regardless of what is rendered, which is what Scenarios 44, 49 and 50 assert.
 * A Branch Admin sees this page and its lines, and does not see Post or
 * Reverse; calling either endpoint directly still returns 403.
 *
 * Whether the *entry* admits an action is a separate question the API answers
 * on the record itself (`canPost`, `canReverse`), because it depends on the
 * journal's status and on whether a reversal already exists.
 */
export default async function JournalPage({
  params,
}: {
  params: Promise<{ journalEntryId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.ACCOUNTING_JOURNALS_VIEW);
  const { journalEntryId } = await params;

  const result = await fetchJournal(journalEntryId);

  if (result.status === "not-found") notFound();

  if (result.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Journal Entry" />
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load this journal entry. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={result.journal.entryNumber} />

      <div className="space-y-6">
        <JournalDetailPanel journal={result.journal} />

        <JournalActions
          journal={result.journal}
          capabilities={{
            canEdit: hasPermissions(
              user,
              PERMISSIONS.ACCOUNTING_JOURNALS_CREATE,
            ),
            canPost: hasPermissions(user, PERMISSIONS.ACCOUNTING_JOURNALS_POST),
            canReverse: hasPermissions(
              user,
              PERMISSIONS.ACCOUNTING_JOURNALS_REVERSE,
            ),
          }}
        />
      </div>
    </div>
  );
}
