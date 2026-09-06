"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Customer Management.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem's internals to whoever triggered the fault would
 * say more about the organization than the screen's own permissions allow.
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
          title="Customer Management unavailable"
          message="We could not load your customers. No changes have been made — please try again."
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
