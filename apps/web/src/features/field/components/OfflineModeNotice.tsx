"use client";

import { Alert } from "@lms/ui";
import React from "react";

/**
 * Offline Mode.
 *
 * The source flow branches `Network Available? → Offline Mode → Load Cached
 * Data → Customer List`. Only the first half of that is honest today: offline
 * caching and synchronization are not implemented (Q-OFF-1..15 are all open),
 * so there is no cached data to load.
 *
 * This screen therefore says so plainly rather than showing an empty customer
 * list. The story is explicit on the point — offline data must never be
 * presented as server-synchronized (Rule 19), and missing records must not be
 * fabricated (Scenario 20). An empty list would imply "you have no customers",
 * which is a different and false claim from "we cannot reach your customers".
 *
 * It is equally explicit that Offline Mode is not a successful GPS
 * verification (Rule 18), so nothing here offers a way to proceed into field
 * operations.
 */
export function OfflineModeNotice() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
        Offline Mode
      </h3>

      <div className="mt-4" role="status" aria-live="polite">
        <Alert
          variant="warning"
          title="You are offline"
          message="Your device has no network connection, so your location cannot be verified and you are not checked in."
        />
      </div>

      <div className="mt-4">
        <Alert
          variant="info"
          title="Cached data is not available"
          message="Offline customer data is not available in this release. Reconnect to load your customer list and complete a GPS check-in."
        />
      </div>

      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        This screen will return to GPS Check-in automatically once your
        connection is restored.
      </p>
    </div>
  );
}
