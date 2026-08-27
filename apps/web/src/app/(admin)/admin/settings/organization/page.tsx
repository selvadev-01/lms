import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  SettingsList,
  fetchSettingCatalog,
  fetchSettings,
} from "@/features/settings";

export const metadata: Metadata = {
  title: "Organization Settings",
};

export const dynamic = "force-dynamic";

/**
 * Organization settings (Scenarios 1, 2).
 *
 * Gated on `settings.view`, never on a write permission. A Branch Admin holds
 * the view code and reaches this screen — they need to see the configuration
 * their branch operates under — and is refused at the specific act. That is what
 * makes Scenarios 44 and 64 provable in an e2e run: a screen that 404'd for them
 * would prove nothing about scope.
 *
 * Which write permission applies depends on the setting's scope and whether the
 * registry marks it protected, so the server decides. `canManage` here only
 * controls whether a form is offered.
 */
export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.SETTINGS_VIEW);
  const { category } = await searchParams;

  const [settings, catalog] = await Promise.all([
    fetchSettings({ category, includeInactive: true }),
    fetchSettingCatalog(),
  ]);

  // The API returns branch rows alongside organization ones by design — a
  // branch-confined caller needs the org row as their effective default, and an
  // unscoped Super Admin gets EVERY branch's overrides. Neither belongs on a
  // screen headed "Organization Settings": the same setting would appear once
  // per branch under one name, and editing such a row would write to that
  // branch. Organization scope is `branchId === null`, so filter for it here.
  const organizationSettings =
    settings.status === "ok"
      ? settings.settings.filter((setting) => setting.branchId === null)
      : [];

  return (
    <div>
      <PageBreadcrumb pageTitle="Organization Settings" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Only settings this system supports can be configured. A setting marked
          &ldquo;Needs approval&rdquo; keeps its current value until a second
          administrator approves the change.
        </p>

        <SettingsList
          settings={organizationSettings}
          catalog={catalog.status === "ok" ? catalog.catalog : []}
          loadError={settings.status !== "ok"}
          canManage={hasPermissions(user, PERMISSIONS.SETTINGS_MANAGE)}
        />
      </div>
    </div>
  );
}
