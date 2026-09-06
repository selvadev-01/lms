import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import { Alert } from "@lms/ui";
import { redirect } from "next/navigation";

import PageShell from "@/components/layout/PageShell";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  COLLECTIONS_PAGE_SIZE,
  CollectionList,
  fetchCollections,
} from "@/features/collections";

export const metadata: Metadata = {
  title: "EMI Collection",
};

export const dynamic = "force-dynamic";

/**
 * The collection list (Module 11, Scenarios 1, 4).
 *
 * Search, status and date range come from the URL so a result set is linkable
 * and survives a refresh, and all of them are passed to the API rather than
 * applied here: the server decides which rows the caller may see, and filtering
 * a list the client already holds would mean the out-of-scope rows had already
 * been sent.
 *
 * There is no branch control, here or in the API. That absence is what makes
 * Scenario 1 structural rather than a check somebody has to remember.
 */
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    page?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.COLLECTIONS_VIEW);
  const params = await searchParams;

  // A junk `?page=abc` falls back to page one rather than erroring — the URL is
  // user-editable here, and refusing to render is the worse answer.
  const page = Math.max(1, Number(params.page) || 1);

  const list = await fetchCollections({
    search: params.search,
    status: params.status,
    fromDate: params.fromDate,
    toDate: params.toDate,
    page,
  });

  // A 401 means the session died since the shell rendered; telling a signed-out
  // user their collections are unavailable would leave them retrying.
  if (list.status === "unauthenticated") redirect("/signin");

  return (
    <PageShell
      title="EMI Collection"
      description="Payments recorded against loan instalments."
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Loans", href: "/loans/applications" },
        { label: "EMI Collection" },
      ]}
    >
      {list.status === "ok" ? (
        <CollectionList
          collections={list.collections}
          page={page}
          pageSize={COLLECTIONS_PAGE_SIZE}
          total={list.total}
          // Carried through so a page link keeps the active filters rather
          // than resetting the screen to an unfiltered page two.
          activeParams={{
            search: params.search,
            status: params.status,
            fromDate: params.fromDate,
            toDate: params.toDate,
          }}
        />
      ) : (
        <Alert
          variant="error"
          title="Collections unavailable"
          message="We could not load collections. Please try again."
        />
      )}
    </PageShell>
  );
}
