"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Branch Management.
 *
 * The message is generic by design. `error.digest` identifies the failure in
 * the server logs; describing the branch subsystem's internals to whoever
 * triggered the fault would say more about the organization's structure than
 * the screen's own permissions allow.
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
          title="Branch Management unavailable"
          message="We could not load your branches. No changes have been made — please try again."
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
