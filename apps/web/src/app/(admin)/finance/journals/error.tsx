"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Journal Entries.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem's internals to whoever triggered the fault
 * would say more about the organization than the screen's own permissions
 * allow.
 *
 * The "nothing has been posted" line is load-bearing, as it is on the disbursal
 * and collection boundaries. A failure here means a read failed or a write was
 * refused before committing — the API's accounting transactions commit or roll
 * back whole, so there is no half-written journal. Saying so is what stops an
 * operator posting the same entry twice out of doubt.
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
          title="Journal Entries unavailable"
          message="We could not load this screen. Nothing has been posted to the ledger and no changes have been made — please try again."
        />
      </div>

      <div className="mt-5">
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
