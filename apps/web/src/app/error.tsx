"use client";

import { useEffect } from "react";
import { Button } from "@lms/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with your error reporter (Sentry, etc.) â€” see TEMPLATE-GUIDE.md Â§3.2.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-title-sm mb-2 font-bold text-gray-800 dark:text-white/90">
        Something went wrong
      </h1>
      <p className="mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
        An unexpected error occurred. Try again, and if the problem persists
        contact support
        {error.digest ? ` with reference ${error.digest}` : ""}.
      </p>
      <Button type="button" onClick={reset} size="sm">
        Try again
      </Button>
    </div>
  );
}
