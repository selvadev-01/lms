"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for EMI Collection.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem's internals to whoever triggered the fault
 * would say more about the organization than the screen's own permissions
 * allow.
 *
 * The "no payment has been recorded" line is load-bearing here in the same way
 * the disbursal boundary's is. A failure on this route means a read failed or a
 * posting was refused before committing — the API's collection transaction
 * commits or rolls back whole, so there is no half-taken payment. Saying so is
 * what stops an operator collecting the same money twice out of doubt, which
 * with a fresh idempotency key the server could not catch.
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
          title="EMI Collection unavailable"
          message="We could not load this screen. No payment has been recorded and no changes have been made — please try again."
        />
      </div>

      <div className="mt-5">
        <Button size="sm" variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
