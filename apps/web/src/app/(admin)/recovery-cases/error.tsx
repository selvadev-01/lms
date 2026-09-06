"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Recovery Cases.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem to whoever triggered the fault would say more
 * about the organization than the screen permissions allow.
 *
 * The "no case was changed" line is load-bearing, as it is on the collection
 * and disbursal boundaries. Every mutation on this route commits or rolls back
 * whole, so a failure leaves no half-assigned case and no half-closed one.
 * Saying so is what stops an operator reassigning or re-closing out of doubt.
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
          title="Recovery Cases unavailable"
          message="We could not load this screen. No recovery case was changed and nothing has been posted — please try again."
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
