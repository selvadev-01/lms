import { NextResponse, type NextRequest } from "next/server";

import { refreshSession } from "@/lib/auth-refresh";

/**
 * Route protection and session renewal.
 *
 * Named `proxy.ts`, not `middleware.ts`: the middleware convention is
 * deprecated in Next.js 16 and renamed to proxy.
 *
 * # Still not the security boundary
 *
 * This is a UX redirect. It checks only that a session cookie *exists* and
 * cannot verify a token; real authorization happens in
 * `features/auth/api/session.ts`, in the data layer, and the API re-validates
 * every request regardless of what happens here.
 *
 * Renewing an expired access token below does not change that. Renewal is not
 * authorization: the API decides whether the refresh token is still good, and
 * refuses a session that was revoked, idled out, or passed its absolute
 * lifetime. Nothing here can extend a session the server considers over.
 *
 * # Why renewal happens here rather than in the read layer
 *
 * `lib/api-fetch.ts` runs during render, where `cookies().set` throws. The
 * expired-access-token case therefore has to be handled before the render
 * begins, and this is the only place that sees every navigation. Doing it here
 * also bounds the cost: once per navigation when the token has lapsed, rather
 * than once per API call — which matters because the API rotates refresh
 * tokens, so concurrent renewals would revoke each other.
 */
const PUBLIC_PATHS = [
  "/signin",
  "/signup",
  // Password recovery is reachable precisely because the user cannot sign in
  // (Scenario 27). Matching is by prefix, so the nested verify and done steps
  // are covered without listing each one.
  "/forgot-password",
  "/reset-password",
  // The terminal screen of Change Password, never the form. By the time the
  // user lands here their sessions are revoked and their cookies cleared, so a
  // protected page would bounce them and swallow the confirmation.
  //
  // A sibling route rather than "/change-password/done": the form lives under
  // (admin) and this under (full-width-pages), and two route groups cannot both
  // claim the same "/change-password" URL segment — Next resolves that conflict
  // by serving a 404 for the whole path. The names must therefore stay distinct.
  "/change-password-done",
  "/error-404",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const signIn = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    // Preserved so the user returns to the page they originally asked for.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  };

  const hasAccess = request.cookies.has("lms_at");
  const hasRefresh = request.cookies.has("lms_rt");

  if (!hasAccess && !hasRefresh) return signIn();

  /**
   * The access token lapsed but the refresh token has not.
   *
   * Before this existed the request continued, the API answered 401 during
   * render, and the user was signed out roughly every fifteen minutes while
   * holding a credential good for seven days.
   *
   * A failed renewal ends the session rather than continuing: the request would
   * only 401 a moment later, and redirecting here keeps the reason legible.
   */
  if (!hasAccess && hasRefresh) {
    const fresh = await refreshSession(request.cookies.toString());
    if (!fresh) return signIn();

    const response = NextResponse.next();
    for (const cookie of fresh) {
      response.cookies.set(cookie.name, cookie.value, {
        httpOnly: true,
        sameSite: "lax",
        secure: cookie.secure,
        path: "/",
      });
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Without a matcher, proxy runs on every request including static assets, and
  // the redirect above would block CSS, JS and images from loading.
  matcher: [
    "/((?!api|_next/static|_next/image|images|favicon.ico|.*\\.svg$).*)",
  ],
};
