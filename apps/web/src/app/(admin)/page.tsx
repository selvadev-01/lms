import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import type { DashboardWidget } from "@lms/types";

import { hasPermissions } from "@/features/auth/utils/require-permissions";
import { requireSession } from "@/features/auth/api/session";
import {
  CashSummaryBody,
  CollectionSummaryBody,
  DashboardFilters,
  LoanSummaryBody,
  OperationalAlertsBody,
  OverdueRecoveryBody,
  QuickActionsBody,
  RecentActivityBody,
  WidgetFetchError,
  WidgetShell,
  fetchDashboardLayout,
  fetchDashboardWidget,
} from "@/features/dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

/**
 * The landing screen — Module 18's operational home.
 *
 * # It deliberately does not call `requirePermissions`
 *
 * This is where `requirePermissions` sends a user who lacks a permission
 * elsewhere, so guarding it the same way would bounce them here and then bounce
 * them off again — a redirect loop out of the one screen everybody can reach.
 * A user without `dashboard.view` gets a plain welcome instead.
 *
 * A Field Employee is the case that matters: they hold few permissions, and
 * they still need somewhere to land after signing in. The seeded Field Employee
 * *does* hold `dashboard.view` and sees four of the seven widgets; the welcome
 * card is for a user holding even less.
 *
 * # Widgets are fetched independently and settled independently
 *
 * `Promise.allSettled`, not `Promise.all`. One widget's request failing renders
 * one error card and leaves its neighbours intact — Rule 33 and Scenario 33. A
 * rejected promise here is distinct from a `FAILED` envelope, which is the
 * server reporting a source it could not reach; both render as an error, and
 * neither renders as a zero.
 *
 * # The layout decides what to ask for, not what is allowed
 *
 * Each widget re-checks its own permission server-side when requested, so this
 * list is a convenience. Fetching all seven regardless would produce a 403 per
 * unauthorized widget on every load, burying the real denials in the audit log.
 */

interface PageProps {
  searchParams: Promise<{
    periodType?: string;
    fromDate?: string;
    toDate?: string;
    branchId?: string;
  }>;
}

/** Inclusive whole days between two ISO dates, both parsed at noon UTC. */
function daySpan(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T12:00:00Z`).getTime();
  const to = new Date(`${toDate}T12:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * Why a custom range was refused, if it was.
 *
 * Mirrors the rules the API enforces (Scenario 5, Rule 37) so the reader is
 * told what is wrong. The API refuses the request regardless — this is the
 * explanation, not the enforcement, which is why the wording matches rather
 * than the logic being shared: a shared rule that only ran here would be no
 * rule at all.
 */
function filterMessage(params: {
  periodType?: string;
  fromDate?: string;
  toDate?: string;
}): string | undefined {
  if (params.periodType !== "CUSTOM") return undefined;

  if (!params.fromDate) return "Period Start Date is required";
  if (!params.toDate) return "Period End Date is required";

  if (params.fromDate > params.toDate) {
    return "Period End Date must be on or after Period Start Date";
  }

  if (daySpan(params.fromDate, params.toDate) > 366) {
    return "Date range cannot exceed 366 days";
  }

  return undefined;
}

/** Renders the body that matches a widget's code. */
function WidgetBody({ widget }: { widget: DashboardWidget<unknown> }) {
  if (widget.status !== "AVAILABLE" && widget.status !== "STALE") return null;

  switch (widget.meta.widgetCode) {
    case "LOAN_SUMMARY":
      return <LoanSummaryBody data={widget.data as never} />;
    case "COLLECTION_SUMMARY":
      return <CollectionSummaryBody data={widget.data as never} />;
    case "OVERDUE_RECOVERY":
      return <OverdueRecoveryBody data={widget.data as never} />;
    case "CASH_SUMMARY":
      return <CashSummaryBody data={widget.data as never} />;
    case "OPERATIONAL_ALERTS":
      return <OperationalAlertsBody data={widget.data as never} />;
    case "QUICK_ACTIONS":
      return <QuickActionsBody data={widget.data as never} />;
    case "RECENT_ACTIVITY":
      return <RecentActivityBody data={widget.data as never} />;
    default:
      return null;
  }
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const user = await requireSession();
  const params = await searchParams;

  if (!hasPermissions(user, PERMISSIONS.DASHBOARD_VIEW)) {
    return (
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <div className="col-span-12">
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 xl:px-10 xl:py-12 dark:border-gray-800 dark:bg-white/[0.03]">
            <h1 className="text-title-sm mb-2 font-bold text-gray-800 dark:text-white/90">
              Welcome back
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Use the menu to reach the screens you have access to.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const filters = {
    periodType: params.periodType,
    fromDate: params.fromDate,
    toDate: params.toDate,
    branchId: params.branchId,
  };

  const layoutResult = await fetchDashboardLayout({
    branchId: params.branchId,
  });

  if (layoutResult.status !== "ok") {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        We could not load the dashboard. Please try again.
      </p>
    );
  }

  const layout = layoutResult.data;

  const settled = await Promise.allSettled(
    layout.widgets.map((spec) =>
      fetchDashboardWidget(spec.widgetCode, filters),
    ),
  );

  // Preserved on the Retry link so a retry returns to the same period and
  // branch rather than silently resetting the user's filters.
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => Boolean(value)) as [
      string,
      string,
    ][],
  ).toString();

  // Reported once, above the widgets: every widget shares the same period, so
  // seven copies of one message would be noise.
  //
  // Checked here rather than read off the failed responses, because `apiGet`
  // deliberately discards the API's message body — it returns a bare
  // `{status:"error"}` so that server text never reaches a screen. The API
  // still enforces the same rule and refuses the request; this only explains
  // *why* the widgets below did not update.
  const filterError = filterMessage(params);

  return (
    <div className="space-y-4 md:space-y-6">
      <DashboardFilters
        layout={layout}
        periodType={params.periodType ?? "THIS_MONTH"}
        fromDate={params.fromDate ?? ""}
        toDate={params.toDate ?? ""}
        error={filterError}
      />

      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-2">
        {layout.widgets.map((spec, index) => {
          const outcome = settled[index];

          // The request itself failed, or returned a failure envelope. Either
          // way an error card, never an empty panel that reads as "no data".
          if (outcome.status !== "fulfilled" || outcome.value.status !== "ok") {
            return (
              <WidgetFetchError
                key={spec.widgetCode}
                title={spec.title}
                query={query}
              />
            );
          }

          const widget = outcome.value.data;

          return (
            <WidgetShell key={spec.widgetCode} widget={widget} query={query}>
              <WidgetBody widget={widget} />
            </WidgetShell>
          );
        })}
      </div>
    </div>
  );
}
