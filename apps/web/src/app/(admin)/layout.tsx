import React from "react";

import { getSession } from "@/features/auth/api/session";
import AdminShell from "./AdminShell";

/**
 * The admin shell's server half.
 *
 * Exists only to resolve the caller and hand what the chrome needs to the client
 * shell: the permissions the sidebar filters on, and the identity the header
 * shows. The interactive parts — the sidebar context, the backdrop, the
 * responsive margin — stay in `AdminShell`, which is a client component.
 *
 * Only the four identity fields cross the boundary, not the whole `AuthUser`.
 * That object carries the full permission list and the org and branch ids, and
 * everything handed to a client component is serialized into the RSC payload
 * the browser receives — so passing it whole would publish more of the session
 * than the header has any use for.
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

  /**
   * An account still on a password an administrator chose reaches Change
   * Password and nothing else.
   *
   * Redirecting from here is what a first attempt did, and it looped: a layout
   * that calls `redirect()` during a client-side navigation never updates the
   * router's URL, so the router retries the destination it was already heading
   * for and the two bounce off each other until the tab gives up. Sign-in now
   * chooses `/change-password` before the navigation begins, which is the only
   * place that decision can be made without fighting the router.
   *
   * What remains here is the deliberate-navigation case — someone typing a URL
   * or using browser history while confined. A full page load reaches the
   * matching `page.tsx`, which is refused there rather than redirected, so the
   * router never has a destination to retry.
   *
   * Neither is the control. `JwtAuthGuard` refuses every API call from a
   * confined account, so a client that ignored all of this would render empty
   * screens rather than data.
   */

  return (
    <AdminShell
      permissions={user?.permissions ?? []}
      user={
        user
          ? {
              name: user.name,
              mobile: user.mobile,
              email: user.email,
              orgCode: user.orgCode,
            }
          : null
      }
    >
      {children}
    </AdminShell>
  );
}
