import { PERMISSIONS } from "@lms/constants";
import {
  MASTER_DATA_CATEGORIES,
  type MasterDataCategory,
} from "@lms/validation";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  CATEGORY_LABELS,
  CategoryTabs,
  MasterDataList,
  fetchMasterDataForManagement,
} from "@/features/master-data";

export const metadata: Metadata = {
  title: "Master Data",
};

export const dynamic = "force-dynamic";

/**
 * Master data — the values behind every dropdown an admin maintains.
 *
 * A Branch Admin reaches this screen (they hold `master_data.view` and need to
 * see how the lists are configured) and is refused every write. The split is not
 * the usual "withhold one grant to prove a denial": an option list is
 * organization-wide configuration, so one branch must not reshape what every
 * other branch can select.
 *
 * The selected list lives in the URL rather than in component state. A server
 * action revalidates this page after every edit, which would reset local state
 * to the first tab — an admin editing document types would be thrown back to
 * genders after each save.
 */
export default async function MasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.MASTER_DATA_VIEW);
  const { category: requested } = await searchParams;

  // An unknown or absent `category` falls back to the first list rather than
  // erroring: the parameter is a view preference, and a stale bookmark should
  // land somewhere useful instead of on a failure page.
  const category: MasterDataCategory = MASTER_DATA_CATEGORIES.includes(
    requested as MasterDataCategory,
  )
    ? (requested as MasterDataCategory)
    : MASTER_DATA_CATEGORIES[0];

  const result = await fetchMasterDataForManagement(category);

  return (
    <div>
      <PageBreadcrumb pageTitle="Master Data" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <CategoryTabs categories={MASTER_DATA_CATEGORIES} active={category} />

        <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
          {CATEGORY_LABELS[category]}
        </h2>

        <MasterDataList
          category={category}
          values={result.status === "ok" ? result.values : []}
          loadError={result.status !== "ok"}
          canManage={hasPermissions(user, PERMISSIONS.MASTER_DATA_MANAGE)}
        />
      </div>
    </div>
  );
}
