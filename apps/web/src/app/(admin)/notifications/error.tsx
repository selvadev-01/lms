"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Notifications.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem to whoever triggered the fault would say more
 * about the organization than the screen permissions allow.
 *
 * The message is explicit that nothing was sent or changed, because a failure
 * on a notification screen invites exactly that worry.
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
          title="Notifications unavailable"
          message="We could not load this screen. No notification was sent, changed or deleted — please try again."
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
