"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Disbursement.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem's internals to whoever triggered the fault
 * would say more about the organization than the screen's own permissions
 * allow.
 *
 * The "no changes have been made" line is load-bearing here in a way it is not
 * on a read screen. A failure on this route means a read failed or a mutation
 * was refused before committing — the API's disbursal transaction commits or
 * rolls back whole, so there is no partial money movement for a reader to worry
 * about. Saying so is what stops an operator retrying a payment they fear went
 * half through.
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
          title="Disbursement unavailable"
          message="We could not load this screen. No funds have moved and no changes have been made — please try again."
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
