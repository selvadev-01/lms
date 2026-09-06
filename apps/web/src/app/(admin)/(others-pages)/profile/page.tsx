import type { Metadata } from "next";

import ProfileCard from "@/components/user-profile/ProfileCard";
import { requireSession } from "@/features/auth";

export const metadata: Metadata = {
  title: "Profile",
};

/**
 * The signed-in user's own profile.
 *
 * A server component reading the real session, where it was a client component
 * rendering a hardcoded fictional person from the original scaffold.
 *
 * `requireSession()` is the authorization boundary, not the proxy: the proxy
 * only checks that a session cookie is present, which is a UX redirect. This
 * validates the session against the API and sends an unauthenticated caller to
 * sign-in.
 *
 * Rendered dynamically. The details here come from the session, so a cached
 * copy would keep showing a name or branch that an administrator has since
 * changed.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireSession();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-5 text-lg font-semibold text-gray-800 lg:mb-7 dark:text-white/90">
        Profile
      </h3>
      <ProfileCard user={user} />
    </div>
  );
}
