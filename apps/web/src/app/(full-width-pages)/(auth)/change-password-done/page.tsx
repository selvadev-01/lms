import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@lms/ui";

export const metadata: Metadata = {
  title: "Password Changed",
};

/**
 * Terminal screen of the Change Password flow (Scenario 38).
 *
 * Lives outside the authenticated shell on purpose. By the time the user
 * arrives, every session has been revoked and the cookies cleared, so rendering
 * this inside `(admin)` would bounce them to sign-in and swallow the message
 * entirely. It is listed in the proxy's public paths for the same reason.
 *
 * Named as a sibling of the form rather than nested under it: the form lives in
 * the `(admin)` group and this in `(full-width-pages)`, and two route groups
 * cannot both claim the `/change-password` segment — Next resolves that
 * conflict by serving a 404 for the whole path.
 *
 * Deliberately a dead end rather than an auto-redirect: the user needs to be
 * told that their sessions were signed out, which a flash-through to the
 * sign-in form would not convey.
 */
export default function ChangePasswordDone() {
  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
            Password Changed
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
