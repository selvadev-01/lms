import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PERMISSIONS } from "@lms/constants";
import type {
  CustomerSummary,
  GuarantorSummary,
  LoanApplicationSummary,
} from "@lms/types";

import { getSession } from "@/features/auth/api/session";
import { env } from "@/lib/env";
import type { SearchHit, SearchResponse } from "@/features/search/types";

/**
 * The header search's single backend.
 *
 * # Why one route rather than a fan-out from the browser
 *
 * The API has no aggregated search endpoint — each resource is its own list
 * route — so a global search has to ask several. Doing that from the browser
 * would spend one of the caller's 60-requests-per-minute on each resource per
 * keystroke-pause, and that bucket is shared with everything else the page
 * loads. The dashboard's per-widget fan-out already exhausts it on its own.
 *
 * Fanning out here costs the browser one request no matter how many resources
 * are queried. The upstream calls happen server-to-server, where they are not
 * subject to the browser's connection limits, and they run concurrently.
 *
 * # It adds no authority of its own
 *
 * Cookies are forwarded and the API's own permission and scope checks decide
 * every result. The permission list read from the session only decides which
 * upstreams are *worth asking* — skipping a resource the caller cannot read
 * avoids a guaranteed 403 per search, which would otherwise bury real denials
 * in the audit log. A caller who somehow reached an upstream they lack is still
 * refused by the API.
 *
 * # Partial failure is reported, not hidden
 *
 * `Promise.allSettled`, so one unreachable resource returns its own failure
 * alongside the others' results. An empty list from a failed lookup would claim
 * "no such customer", which is a different statement from "we could not look".
 */

/** Upstream calls are given their own deadline so one slow resource cannot */
/** hold the whole search open. */
const UPSTREAM_TIMEOUT_MS = 5_000;

/** Per resource. The palette shows a handful and links to the full list. */
const PER_RESOURCE_LIMIT = 5;

type Source = {
  /** Stable id, also the group label's key in the UI. */
  key: string;
  label: string;
  permission: string;
  /** Upstream path, including the query string the resource expects. */
  path: (term: string) => string;
  /** Maps the upstream body to hits. Defensive: the body is not re-validated */
  /** beyond the shape access, so a missing array yields no hits, not a throw. */
  map: (body: unknown) => SearchHit[];
};

const SOURCES: Source[] = [
  {
    key: "customers",
    label: "Customers",
    permission: PERMISSIONS.CUSTOMERS_VIEW,
    path: (term) => `/customers?search=${encodeURIComponent(term)}`,
    map: (body) =>
      ((body as { customers?: CustomerSummary[] })?.customers ?? []).map(
        (c) => ({
          id: c.customerId,
          title: c.fullName,
          // Code and masked mobile: enough to tell two people of the same name
          // apart. The mobile is already masked by the API in list responses.
          subtitle: [c.customerCode, c.mobile].filter(Boolean).join(" · "),
          badge: c.status,
          href: `/customers/${c.customerId}`,
        }),
      ),
  },
  {
    key: "guarantors",
    label: "Guarantors",
    permission: PERMISSIONS.CUSTOMERS_GUARANTORS_VIEW,
    path: (term) => `/guarantors?search=${encodeURIComponent(term)}`,
    map: (body) =>
      (Array.isArray(body) ? (body as GuarantorSummary[]) : []).map((g) => ({
        id: g.guarantorId,
        title: g.fullName,
        subtitle: [g.mobile, g.relationship].filter(Boolean).join(" · "),
        badge: g.status,
        href: `/guarantors/${g.guarantorId}`,
      })),
  },
  {
    key: "applications",
    label: "Loan Applications",
    permission: PERMISSIONS.LOANS_APPLICATIONS_VIEW,
    path: (term) => `/loan-applications?search=${encodeURIComponent(term)}`,
    map: (body) =>
      (
        (body as { applications?: LoanApplicationSummary[] })?.applications ??
        []
      ).map((a) => ({
        id: a.applicationId,
        title: a.applicationNumber,
        subtitle: [a.customerName, a.customerCode].filter(Boolean).join(" · "),
        badge: a.status,
        href: `/loans/applications/${a.applicationId}`,
      })),
  },
];

/** One upstream lookup, resolved to hits or to an explicit failure. */
async function query(
  source: Source,
  term: string,
  cookie: string,
): Promise<{ key: string; label: string; hits: SearchHit[]; failed: boolean }> {
  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1${source.path(term)}`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      // A 403 here means the caller holds the view permission but is refused by
      // scope. That is not an outage, and reporting it as one would be noise —
      // it correctly yields no results for this resource.
      return {
        key: source.key,
        label: source.label,
        hits: [],
        failed: response.status !== 403 && response.status !== 404,
      };
    }

    return {
      key: source.key,
      label: source.label,
      hits: source.map(await response.json()).slice(0, PER_RESOURCE_LIMIT),
      failed: false,
    };
  } catch {
    return { key: source.key, label: source.label, hits: [], failed: true };
  }
}

export async function GET(request: Request): Promise<Response> {
  const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  // Two characters before anything is asked upstream. A single character
  // matches most of the book on a contains-search, which is a slow query
  // returning nothing useful.
  if (term.length < 2) {
    return NextResponse.json({ groups: [], failed: [] } satisfies SearchResponse);
  }

  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const cookie = cookieStore.toString();

  const held = new Set(user.permissions);
  const askable = SOURCES.filter((s) => held.has(s.permission));

  const settled = await Promise.all(
    askable.map((source) => query(source, term, cookie)),
  );

  return NextResponse.json({
    groups: settled
      .filter((r) => r.hits.length > 0)
      .map((r) => ({ key: r.key, label: r.label, hits: r.hits })),
    failed: settled.filter((r) => r.failed).map((r) => r.label),
  } satisfies SearchResponse);
}