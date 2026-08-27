import type { Metadata } from "next";
import Link from "next/link";
import React from "react";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requireSession } from "@/features/auth";
import { requireVerifiedCheckIn } from "@/features/field";

export const metadata: Metadata = {
  title: "Field Dashboard",
};

// Verification expires, so this page must never be served from a cache.
export const dynamic = "force-dynamic";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Field Employee landing page.
 *
 * Two gates, in order: `requireSession()` establishes who the caller is, and
 * `requireVerifiedCheckIn()` establishes that they hold a current verified
 * location. Without the second, this screen redirects to GPS Check-in — the
 * source flow reaches field operations only through `Location Verified`
 * (Scenario 5).
 *
 * Offline Mode is still not implemented here beyond detection: caching and
 * synchronization are Q-OFF-1..15, all unresolved.
 */
export default async function FieldDashboardPage() {
  const user = await requireSession();
  const status = await requireVerifiedCheckIn();

  const checkIn = status.checkIn;

  return (
    <div>
      <PageBreadcrumb pageTitle="Field Dashboard" />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 xl:px-10 xl:py-12 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mx-auto w-full max-w-[630px] text-center">
          <h3 className="text-theme-xl mb-4 font-semibold text-gray-800 sm:text-2xl dark:text-white/90">
            Welcome, {user.name}
          </h3>
          <p className="text-sm text-gray-500 sm:text-base dark:text-gray-400">
            Organization {user.orgCode}
            {user.branchName ? ` · Branch ${user.branchName}` : ""}
          </p>

          {checkIn && (
            <div className="border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15 mt-6 inline-flex flex-col items-center gap-1 rounded-xl border px-5 py-3">
              <span className="text-success-600 dark:text-success-400 text-sm font-medium">
                Location verified
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatTimestamp(checkIn.verifiedAt ?? checkIn.createdAt)} ·
                valid for {status.validityHours} hours
              </span>
            </div>
          )}

          <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
            <Link
              href="/field/check-in"
              className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
            >
              Check location again
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
