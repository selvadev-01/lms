import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requireSession } from "@/features/auth/api/session";
import { hasPermissions } from "@/features/auth/utils/require-permissions";
import { fetchPreferences, PreferenceForm } from "@/features/notifications";

export const metadata: Metadata = { title: "Notification Preferences" };
export const dynamic = "force-dynamic";

/**
 * Your own notification preferences.
 *
 * # Reading is not gated, changing is
 *
 * `requireSession` rather than `requirePermissions`: a user who cannot change
 * their preferences still needs to see what they are, if only to know why they
 * are receiving something. `notifications.preferences.manage` decides whether
 * the form can be submitted, and the API refuses again regardless.
 *
 * There is no `userId` anywhere on this screen or the route behind it, which is
 * what makes Scenario 19 structural rather than a check.
 */
export default async function NotificationPreferencesPage() {
  const user = await requireSession();
  const preferences = await fetchPreferences();

  return (
    <div>
      <PageBreadcrumb pageTitle="Notification Preferences" />

      {preferences.status === "ok" ? (
        <PreferenceForm
          preferences={preferences.preferences}
          canManage={hasPermissions(
            user,
            PERMISSIONS.NOTIFICATIONS_PREFERENCES_MANAGE,
          )}
        />
      ) : (
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load your preferences. Please try again.
        </p>
      )}
    </div>
  );
}
