import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * Unread-count proxy for the header bell.
 *
 * A route handler rather than a server action because the bell polls: it wants
 * a number back to render, not a form state transition, and it runs on every
 * admin page for as long as someone is signed in.
 *
 * The count could instead be threaded from the server layout, as `permissions`
 * is for the sidebar. Rejected: the layout renders once per navigation, so a
 * notification arriving while a user reads one page would not surface until
 * they moved. A badge that is stale for minutes is worse than one extra
 * lightweight request a minute.
 *
 * **Adds no authority of its own.** Cookies are forwarded and the API decides;
 * it scopes the count to the session's own user and offers no parameter that
 * could widen it.
 */
export async function GET(): Promise<Response> {
  const cookieStore = await cookies();

  const upstream = await fetch(
    `${env.API_BASE_URL}/api/v1/notifications/unread-count`,
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  // Status passed through, so a 401 stays distinguishable from an outage and
  // the bell can leave its last known count alone rather than showing zero.
  return NextResponse.json((await upstream.json()) as unknown, {
    status: upstream.status,
  });
}
