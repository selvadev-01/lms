import "server-only";

import type { AuditEventDetail, AuditEventListResult } from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Module 17 — reading the audit trail.
 *
 * There is deliberately no mutation here and no action file beside it. Rules 46
 * and 47 make the trail append-only and immutable to application users, and the
 * absence of a write path in this layer is one of three enforcing it — the API
 * exposes no write route, and `audit_logs` carries a database trigger refusing
 * UPDATE and DELETE.
 *
 * Filtering is server-side (Rule 55). The parameters below are a REQUEST: the
 * server decides what the caller may actually see, narrowing a branch-confined
 * reader whatever they ask for.
 */

export interface AuditFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type AuditListOutcome =
  | { status: "ok"; result: AuditEventListResult }
  | FetchFailure;

export type AuditDetailOutcome =
  | { status: "ok"; event: AuditEventDetail }
  | { status: "not-found" }
  | FetchFailure;

function toQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchAuditEvents(
  filters: AuditFilters = {},
): Promise<AuditListOutcome> {
  const result = await apiGet<AuditEventListResult>(
    `/audit${toQuery(filters)}`,
  );

  return result.status === "ok"
    ? { status: "ok", result: result.data }
    : result;
}

/**
 * One event.
 *
 * `apiGetRecord` collapses 403 and 404 to `not-found`, which is what stops an
 * id from being enumerable: a reader outside the event's branch learns the same
 * thing whether it exists or not (Scenario 46).
 */
export async function fetchAuditEvent(
  auditId: string,
): Promise<AuditDetailOutcome> {
  const result = await apiGetRecord<AuditEventDetail>(`/audit/${auditId}`);

  return result.status === "ok"
    ? { status: "ok", event: result.data }
    : result;
}

/** The href for the CSV export, so the browser downloads it directly. */
export function auditExportHref(filters: AuditFilters): string {
  return `/api/v1/audit/export${toQuery(filters)}`;
}
