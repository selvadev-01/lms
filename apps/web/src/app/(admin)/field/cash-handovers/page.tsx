import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import Link from "next/link";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  AgentCashBalancePanel,
  CashHandoverList,
  fetchAgentCashBalances,
  fetchCashHandovers,
} from "@/features/field";

export const metadata: Metadata = {
  title: "Cash Handover",
};

export const dynamic = "force-dynamic";

/**
 * Cash handovers, and — for a branch user — who is still holding cash.
 *
 * The balance panel is only fetched when the caller can receive cash: it is a
 * cross-agent read, and an agent has no business seeing what colleagues are
 * carrying. The API gates it on the same permission, so this is the UI agreeing
 * with the server rather than deciding on its own.
 *
 * The two reads run in parallel, and the balances degrade to `null` rather than
 * failing the page: a handover list is still useful when the derived balances
 * cannot be computed.
 */
export default async function CashHandoversPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CASH_HANDOVERS_VIEW);
  const params = await searchParams;

  const canReceive = hasPermissions(user, PERMISSIONS.CASH_HANDOVERS_RECEIVE);

  const [list, balances] = await Promise.all([
    fetchCashHandovers({
      search: params.search,
      status: params.status,
      fromDate: params.fromDate,
      toDate: params.toDate,
    }),
    canReceive ? fetchAgentCashBalances() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageBreadcrumb pageTitle="Cash Handover" />

        {hasPermissions(user, PERMISSIONS.CASH_HANDOVERS_SUBMIT) ? (
          <Link
            href="/field/cash-handovers/new"
            className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2.5 text-sm font-medium text-white"
          >
            Hand over cash
          </Link>
        ) : null}
      </div>

      {balances?.status === "ok" ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Cash with agents
          </h2>
          <AgentCashBalancePanel agents={balances.agents} />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Handovers
        </h2>
        {list.status === "ok" ? (
          <CashHandoverList handovers={list.handovers} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load cash handovers. Please try again.
          </p>
        )}
      </section>
    </div>
  );
}
