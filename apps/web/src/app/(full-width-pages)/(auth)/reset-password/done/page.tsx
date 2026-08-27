import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@lms/ui";

export const metadata: Metadata = {
  title: "Password Reset",
};

/**
 * Terminal screen of the recovery flow (Q-REC-15).
 *
 * Deliberately a dead end rather than an auto-redirect: the user needs to be
 * told that their other sessions were signed out, which a flash-through to the
 * sign-in form would not convey.
 */
export default function ResetPasswordDone() {
  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
            Password Reset
          </h1>
        </div>

        <div className="mb-6">
          <Alert
            variant="success"
            title="Your password has been changed"
            message="For your security you have been signed out everywhere. Sign in with your new password to continue."
          />
        </div>

        <Link
          href="/signin"
          className="bg-brand-500 shadow-theme-xs hover:bg-brand-600 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white transition"
        >
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
