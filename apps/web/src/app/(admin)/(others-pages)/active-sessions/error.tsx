"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for the Active Sessions route.
 *
 * The message is deliberately generic. `error.digest` identifies the failure in
 * the server logs; surfacing anything more on a security screen would risk
 * describing the session subsystem's internals to whoever triggered the fault.
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
          title="Sessions unavailable"
          message="We could not load your active sessions. Your account is unaffected — please try again."
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
