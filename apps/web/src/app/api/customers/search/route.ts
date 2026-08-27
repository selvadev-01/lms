import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * Customer lookup proxy for the application wizard's step 1.
 *
 * A route handler rather than a server action for the same reason as
 * `loan-applications/emi-preview`: the wizard queries this as the user types and
 * wants rows back to render, not a form state transition. `useActionState` would
 * re-render the whole form on each keystroke and lose focus in the search box.
 *
 * The alternative was the wizard's original approach — pre-fetch every active
 * customer and filter in the browser. Rejected: that ships the organization's
 * whole active-customer set to the client on page load, and the display cap that
 * made it tolerable also made a customer past the cap impossible to find. The
 * API already resolves a search term as name-contains / code-exact /
 * mobile-prefix (Rule 19), so asking the server is both narrower and correct.
 *
 * **Adds no authority of its own.** Cookies are forwarded and the API's own
 * scope and permission checks decide; a Branch Admin still sees only their
 * branch, because that confinement is applied server-side regardless of filters.
 */
export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies();

  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";

  const params = new URLSearchParams({ status: "ACTIVE" });
  if (search) params.set("search", search);

  const upstream = await fetch(
    `${env.API_BASE_URL}/api/v1/customers?${params.toString()}`,
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  // Status passed through, so a 403 stays distinguishable from an outage.
  return NextResponse.json((await upstream.json()) as unknown, {
    status: upstream.status,
  });
}
