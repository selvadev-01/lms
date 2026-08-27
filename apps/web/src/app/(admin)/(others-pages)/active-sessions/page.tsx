import type { Metadata } from "next";

import {
  ActiveSessionsList,
  fetchActiveSessions,
  requireSession,
} from "@/features/auth";

export const metadata: Metadata = {
  title: "Active Sessions",
};

/**
 * Profile / Account Security → Active Sessions.
 *
 * `requireSession()` is the authorization boundary, not the proxy: the proxy
 * only checks that a session cookie is present, which is a UX redirect. This
 * validates the session against the API and sends an unauthenticated caller to
 * sign-in (Scenario 2).
 *
 * Rendered dynamically. A cached session list would be actively misleading on
 * a security screen — it could show a session the user has already ended, or
 * hide one that was just created elsewhere.
 */
export const dynamic = "force-dynamic";

export default async function ActiveSessionsPage() {
  await requireSession();

  const result = await fetchActiveSessions();

  // An unreadable list is reported as an error rather than as "no sessions":
  // on this screen the two mean very different things (Scenario 36).
  return (
    <ActiveSessionsList
      sessions={result.status === "ok" ? result.sessions : []}
      loadError={result.status !== "ok"}
    />
  );
}
