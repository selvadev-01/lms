import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requireSession } from "@/features/auth";
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
 */
export default async function GpsCheckInPage() {
  await requireSession();

  const result = await fetchCheckInStatus();

  if (result.status === "unauthenticated") redirect("/signin");
  // Not a field employee at all: send them to the dashboard they can use
  // rather than to a screen that will only refuse them.
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
