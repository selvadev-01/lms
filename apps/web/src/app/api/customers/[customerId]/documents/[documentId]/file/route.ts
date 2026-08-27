import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * KYC document download proxy (Module 04, Scenarios 12, 32).
 *
 * The only route handler in the web app, and it exists for one reason: the API
 * runs on a different origin, so a browser navigating straight to it would not
 * send the session cookies and every download would be a 401. Server actions
 * cannot help — a download is a navigation, not a form post, and the sandboxed
 * response of an action cannot become a file the browser saves.
 *
 * **This proxy adds no authority of its own.** It forwards the caller's cookies
 * and returns whatever the API decides. The scope check, the permission check
 * and the audit entry all happen in `DocumentService.download`; if the caller
 * cannot reach the customer, this route returns the API's 404 unchanged. A
 * handler that fetched with a service credential instead would be exactly the
 * hole Scenario 32 describes.
 *
 * Headers are copied rather than re-derived, so the `Content-Disposition:
 * attachment` and `nosniff` the API sets are the ones the browser receives.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string; documentId: string }> },
): Promise<Response> {
  const { customerId, documentId } = await context.params;
  const cookieStore = await cookies();

  const upstream = await fetch(
    `${env.API_BASE_URL}/api/v1/customers/${encodeURIComponent(
      customerId,
    )}/documents/${encodeURIComponent(documentId)}/file`,
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  if (!upstream.ok || !upstream.body) {
    // Passed through as-is: a 404 here means the API refused, and rewriting it
    // into something friendlier would hide a scope denial behind an outage.
    return NextResponse.json(
      { message: "That document is not available." },
      { status: upstream.status === 200 ? 502 : upstream.status },
    );
  }

  const headers = new Headers();
  for (const header of [
    "content-type",
    "content-length",
    "content-disposition",
    "x-content-type-options",
    "cache-control",
  ]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new Response(upstream.body, { status: 200, headers });
}
