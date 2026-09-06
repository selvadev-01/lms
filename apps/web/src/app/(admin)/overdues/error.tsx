"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Overdue Accounts.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem to whoever triggered the fault would say more
 * about the organization than the screen permissions allow.
 *
 * This surface is read-only — it derives figures and writes nothing — so a
 * failure here can only be a failed read. Saying so plainly is what stops an
 * operator assuming a borrower record was altered.
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
          title="Overdue Accounts unavailable"
          message="We could not load this screen. Nothing has been changed — this view only reads, and no recovery record was altered. Please try again."
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
