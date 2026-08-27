import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  ConfigTransferPanel,
  fetchConfigurationExport,
} from "@/features/settings";

export const metadata: Metadata = {
  title: "Configuration Transfer",
};

export const dynamic = "force-dynamic";

/**
 * Configuration import and export (Scenarios 59-62).
 *
 * Gated on `settings.export` — the read half. Import is gated separately, and a
 * caller holding only export reaches this screen and sees the document without
 * the import form. That split exists because an import writes many settings at
 * once, so it is not implied by permission to read them.
 */
export default async function ConfigurationTransferPage() {
  const user = await requirePermissions(PERMISSIONS.SETTINGS_EXPORT);

  const exported = await fetchConfigurationExport();

  return (
    <div>
      <PageBreadcrumb pageTitle="Configuration Transfer" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          An export carries this organization&rsquo;s active settings. An import
          is checked in full before anything is written: if any entry cannot be
          applied, none of them are.
        </p>

        <ConfigTransferPanel
          document={exported.status === "ok" ? exported.document : null}
          loadError={exported.status !== "ok"}
          canImport={hasPermissions(user, PERMISSIONS.SETTINGS_IMPORT)}
        />
      </div>
    </div>
  );
}
