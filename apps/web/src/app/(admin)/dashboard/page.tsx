import { redirect } from "next/navigation";

/**
 * `/dashboard` — the route the specification suggests.
 *
 * The dashboard lives at `/`, because that is the landing screen and having two
 * implementations of the same page is how the two drift. This exists so the
 * suggested URL resolves rather than 404s for anyone who bookmarks it or
 * follows it from documentation.
 */
export default function DashboardRedirectPage(): never {
  redirect("/");
}
