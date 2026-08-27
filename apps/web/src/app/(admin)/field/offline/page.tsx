import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requireSession } from "@/features/auth";
import { OfflineModeNotice } from "@/features/field";

export const metadata: Metadata = { title: "Offline Mode" };

/**
 * Offline Mode.
 *
 * Still an authenticated route: the source flow reaches Offline Mode *after*
 * `Field Employee Login`, so this is not a way around signing in. It is not
 * added to `PUBLIC_PATHS` in `proxy.ts` for that reason.
 *
 * There is a genuine limitation worth naming: reaching this page requires the
 * network, because `requireSession()` calls the API. A user who is already
 * offline will therefore see it via the check-in panel's client-side network
 * detection rather than by navigating here. Serving it without a network at all
 * needs a service worker, which is out of scope with Q-OFF-1..15 unresolved.
 */
export default async function FieldOfflinePage() {
  await requireSession();

  return (
    <div>
      <PageBreadcrumb pageTitle="Offline Mode" />
      <OfflineModeNotice />
    </div>
  );
}
