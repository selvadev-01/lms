"use client";

import { Alert, Button } from "@lms/ui";

/**
 * Error boundary for the GPS Check-in route.
 *
 * States plainly that the user is *not* checked in. A failure here must never
 * read as though verification might have succeeded — that is the whole point of
 * the story's fail-closed rule.
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
          title="Check-in unavailable"
          message="We could not load the GPS check-in screen, so your location has not been verified. Please try again."
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
