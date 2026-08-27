import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * Notification list proxy for the header bell's preview.
 *
 * Fetched once when the dropdown is opened, which is when being current is
 * worth a request. The badge itself polls the cheaper `unread-count` route.
 *
 * Only `pageSize` is forwarded, and it is clamped. The bell shows five recent
 * notifications; forwarding arbitrary filters would duplicate the notification
 * centre in a dropdown, and forwarding an arbitrary page size would let a
 * client ask for the whole history through a surface meant for a preview.
 *
 * **Adds no authority of its own.** Cookies are forwarded and the API scopes
 * every read to the session's own user.
 */
export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies();

  const requested = Number(
    new URL(request.url).searchParams.get("pageSize") ?? "5",
  );
  const pageSize = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), 10)
    : 5;

  const upstream = await fetch(
    `${env.API_BASE_URL}/api/v1/notifications?pageSize=${pageSize}`,
    {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    },
  );

  return NextResponse.json((await upstream.json()) as unknown, {
    status: upstream.status,
  });
}
