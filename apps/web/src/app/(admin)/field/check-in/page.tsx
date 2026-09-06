import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { redirect } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { GpsCheckInPanel, fetchCheckInStatus } from "@/features/field";

export const metadata: Metadata = { title: "GPS Check-in" };

// Whether the caller is checked in changes with every attempt, so this page
// must never be served from a cache.
export const dynamic = "force-dynamic";

/**
 * Acquisition timeout offered to the browser (Q-GPS-7).
 *
 * Mirrors `FIELD_GPS_TIMEOUT_SECONDS` in the API config. It is duplicated
 * rather than fetched because it only shapes how long the *browser* waits — the
 * server's copy is the one that governs any decision, and the two disagreeing
 * would at worst change how long a user waits before seeing a timeout.
 */
const GPS_TIMEOUT_SECONDS = 30;

/**
 * GPS Check-in.
 *
 * Deliberately does not use `requireVerifiedCheckIn()` — this is the screen
 * that guard sends people to, and calling it here would loop.
 *
 * Gated on `field.checkin`, the same permission the API's `/field/check-in`
 * controller requires. The `forbidden` branch below still stands: this check
 * decides locally what that round trip would otherwise have to discover, so a
 * non-field user is redirected before the request rather than after it.
 */
export default async function GpsCheckInPage() {
  await requirePermissions(PERMISSIONS.FIELD_CHECKIN);

  const result = await fetchCheckInStatus();

  if (result.status === "unauthenticated") redirect("/signin");
  // Kept as defence in depth: the permission above is resolved from a profile
  // cached for up to 60s, so a revoked grant can still reach the API and be
  // refused there.
  if (result.status === "forbidden") redirect("/");

  const status = result.status === "ok" ? result.data : null;

  return (
    <div>
      <PageBreadcrumb pageTitle="GPS Check-in" />
      <GpsCheckInPanel
        verifiedCheckIn={status?.verified ? status.checkIn : null}
        timeoutSeconds={GPS_TIMEOUT_SECONDS}
        validityHours={status?.validityHours ?? 12}
        loadError={result.status === "error"}
      />
    </div>
  );
}
