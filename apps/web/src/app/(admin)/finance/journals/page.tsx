import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import Link from "next/link";
import { Button } from "@lms/ui";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { JournalList, fetchJournals } from "@/features/accounting";

export const metadata: Metadata = {
  title: "Journal Entries",
};

export const dynamic = "force-dynamic";

/**
 * The journal list (Module 14, Scenarios 32, 34).
 *
 * Shows hand-authored journals alongside the entries source modules posted — a
 * finance user looking for yesterday's disbursals is the ordinary case, and a
 * ledger that hid them would be describing a different set of books from the
 * one the trial balance reports.
 *
 * There is no branch control. Confinement is applied server-side from the
 * caller's scope, and there is no request parameter through which it could be
 * widened.
 */
export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    entryType?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.ACCOUNTING_JOURNALS_VIEW);
  const params = await searchParams;

  const canCreate = hasPermissions(
    user,
    PERMISSIONS.ACCOUNTING_JOURNALS_CREATE,
  );

  const list = await fetchJournals({
    search: params.search,
    status: params.status,
    entryType: params.entryType,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Journal Entries" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {canCreate && (
          <div className="mb-5 flex justify-end">
            <Link href="/finance/journals/new">
              <Button type="button" size="sm">
                New journal
              </Button>
            </Link>
          </div>
        )}

        {list.status === "ok" ? (
          <JournalList journals={list.journals} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load journal entries. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
