import React from "react";

import { getSession } from "@/features/auth/api/session";
import AdminShell from "./AdminShell";

/**
 * The admin shell's server half.
 *
 * Exists only to resolve the caller's permissions and hand them to the client
 * shell, so the sidebar can hide the menu entries they cannot use. The
 * interactive parts — the sidebar context, the backdrop, the responsive margin —
 * stay in `AdminShell`, which is a client component.
 *
 * `getSession` is React-cached, so this costs no extra request: the pages
 * beneath call the same function through `requirePermissions`.
 *
 * A null session is not redirected here. Every page below runs its own
 * `requirePermissions`, and the proxy already bounces a request with no cookie;
 * duplicating that redirect in the layout would only add a second place for the
 * sign-in path to drift.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();

  return (
    <AdminShell permissions={user?.permissions ?? []}>{children}</AdminShell>
  );
}
