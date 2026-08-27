import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound, redirect } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  JournalForm,
  fetchJournal,
  fetchPostableAccounts,
} from "@/features/accounting";

export const metadata: Metadata = {
  title: "Edit Journal",
};

export const dynamic = "force-dynamic";

/**
 * Edit a draft journal (Module 14, Scenarios 35, 57).
 *
 * Only a draft is editable. A posted entry is redirected back to its detail
 * page rather than rendered in a form that could not save — the API and the
 * `journal_entries_append_only` trigger both refuse the write, and offering the
 * form would be an invitation to discover that the hard way.
 */
export default async function EditJournalPage({
  params,
}: {
  params: Promise<{ journalEntryId: string }>;
}) {
  await requirePermissions(PERMISSIONS.ACCOUNTING_JOURNALS_CREATE);
  const { journalEntryId } = await params;

  const [journal, accounts] = await Promise.all([
    fetchJournal(journalEntryId),
    fetchPostableAccounts(),
  ]);

  if (journal.status === "not-found") notFound();

  if (journal.status !== "ok" || accounts.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Edit Journal" />
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load this journal. Please try again.
        </p>
      </div>
    );
  }

  if (!journal.journal.canEdit) {
    redirect(`/finance/journals/${journalEntryId}`);
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={`Edit ${journal.journal.entryNumber}`} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <JournalForm accounts={accounts.accounts} journal={journal.journal} />
      </div>
    </div>
  );
}
