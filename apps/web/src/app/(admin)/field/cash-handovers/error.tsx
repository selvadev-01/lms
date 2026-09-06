"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Cash Handover.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem's internals to whoever triggered the fault would
 * say more about the organization than the screen's own permissions allow.
 *
 * The reassurance line is load-bearing, in the same way the EMI collection
 * boundary's is. A failure on this route means a read failed or a write was
 * refused before committing — the API's transactions commit or roll back whole,
 * so no partial state exists. Saying so is what stops an operator repeating a
 * money-moving action out of doubt, which with a fresh idempotency key the
 * server could not catch as a duplicate.
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
          title="Cash Handover unavailable"
          message="We could not load this screen. No cash has been accepted and no custody transfer has been posted — please try again."
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
