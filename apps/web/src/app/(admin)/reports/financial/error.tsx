"use client";

import { Alert } from "@lms/ui";

/**
 * Error boundary for the Financial Report.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing the subsystem to whoever triggered it would say more about the
 * organization than this screen's permissions allow.
 *
 * The "nothing was changed" line is load-bearing here in a way it is not on a
 * form: reports are read-only views of other modules' data (Rules 5, 6, 17), so
 * a failed report cannot have altered a loan, a collection or the ledger. Say
 * so, and nobody goes looking for damage that cannot exist.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div role="alert" aria-live="assertive">
        <Alert
          variant="error"
          title="Financial Report unavailable"
          message="We could not generate this report. Nothing was changed — a report only reads data it never writes — so please try again."
        />
      </div>

      <button
        type="button"
        onClick={reset}
        className="bg-brand-500 hover:bg-brand-600 mt-5 h-11 rounded-lg px-5 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
