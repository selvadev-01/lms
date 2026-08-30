import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { CSRF_HEADERS } from "@/lib/api-call";
import { env } from "@/lib/env";

/**
 * EMI preview proxy for the wizard's step 4.
 *
 * A route handler rather than a server action because the wizard calls this
 * repeatedly as the user adjusts the amount, rate and duration, and wants the
 * schedule back to render — not a form state transition. `useActionState` would
 * re-render the whole form on each calculation and lose focus in the field being
 * edited.
 *
 * The alternative was importing `@lms/emi` directly into the client component.
 * Rejected deliberately: the server's figure is what submit and approve are
 * checked against, and a browser-side calculation that disagreed by a paisa
 * would be worse than a brief spinner. One source of truth, one round trip.
 *
 * **Adds no authority of its own.** Cookies are forwarded and the API's own
 * `loans.applications.view` check decides; a caller without it gets the API's
 * 403 unchanged.
 */
export async function POST(request: Request): Promise<Response> {
  const cookieStore = await cookies();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const upstream = await fetch(
    `${env.API_BASE_URL}/api/v1/loan-applications/emi-preview`,
    {
      method: "POST",
      headers: {
        ...CSRF_HEADERS,
        cookie: cookieStore.toString(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  // Status passed through, so a 400 from the calculator stays a 400 the caller
  // can distinguish from an outage.
  return NextResponse.json((await upstream.json()) as unknown, {
    status: upstream.status,
  });
}
