import type { AgentCashBalance } from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

/**
 * Which agents are carrying cash, and how long they have had it (Scenario 21).
 *
 * A server component. Every figure is **derived** on read from posted,
 * unreversed, unclaimed cash collections — nothing here is a stored running
 * total, so it cannot drift from the collections behind it (Rule 24).
 *
 * Agents with a zero balance are omitted by the API. This is a work list —
 * "who owes the branch money" — and a page of zeroes buries the agents who do.
 *
 * The aging column is the reason this is a panel rather than a number: cash
 * that has been out for a week is a different problem from cash collected this
 * morning, and the balance alone cannot tell them apart.
 */
export default function AgentCashBalancePanel({
  agents,
}: {
  agents: AgentCashBalance[];
}) {
  if (agents.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No agent is currently holding collected cash.
      </p>
    );
  }

  const total = agents.reduce(
    (sum, agent) => sum + BigInt(agent.expectedCashPaise),
    // `BigInt(0)` rather than `0n`: this app targets ES2017, where the literal
    // form is a syntax error.
    BigInt(0),
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Agent</th>
            <th className="px-5 py-3 font-medium">Branch</th>
            <th className="px-5 py-3 text-right font-medium">Collections</th>
            <th className="px-5 py-3 font-medium">Oldest</th>
            <th className="px-5 py-3 text-right font-medium">Cash in hand</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr
              key={agent.fieldAgentId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {agent.agentName}
                {agent.employeeCode ? (
                  <span className="ml-2 text-xs text-gray-400">
                    {agent.employeeCode}
                  </span>
                ) : null}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {agent.branchName ?? "—"}
              </td>
              <td className="px-5 py-3 text-right text-gray-500 tabular-nums dark:text-gray-400">
                {agent.unclaimedCollectionCount}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {agent.oldestUnclaimedDate
                  ? formatDate(agent.oldestUnclaimedDate)
                  : "—"}
              </td>
              <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(agent.expectedCashPaise)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03]">
            <td
              className="px-5 py-3 text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
              colSpan={4}
            >
              Total outstanding with agents
            </td>
            <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(total.toString())}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
