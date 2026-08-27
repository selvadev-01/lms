"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for Recovery Activity.
 *
 * Generic by design: `error.digest` identifies the failure in the server logs,
 * and describing this subsystem to whoever triggered the fault would say more
 * about the organization than the screen permissions allow.
 *
 * There is no list page at this segment — an activity is always reached from
 * its case — so this boundary and its sibling `loading.tsx` exist to cover the
 * detail route alone rather than being inherited from a level that renders a
 * different shape.
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
          title="Recovery Activity unavailable"
          message="We could not load this activity. Nothing has been changed — please try again."
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
