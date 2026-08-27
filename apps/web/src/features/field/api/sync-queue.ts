import "server-only";

import type { SyncQueueItem } from "@lms/types";

import { apiGet, type FetchFailure } from "@/lib/api-fetch";

/**
 * The offline sync queue (Module 12).
 *
 * This lists what devices *say* they are holding, not authoritative work. A
 * queue row is a device's assertion about its own state; nothing financial
 * turns on it, and the capture it describes only becomes real when it posts
 * through the sync endpoint.
 *
 * Scoped server-side: an agent sees their own device's queue, a supervisor sees
 * the branch's.
 */

export type SyncQueueListResult =
  { status: "ok"; items: SyncQueueItem[]; total: number } | FetchFailure;

export async function fetchSyncQueue(params?: {
  status?: string;
}): Promise<SyncQueueListResult> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{ items: SyncQueueItem[]; total: number }>(
    `/field/sync-items${suffix}`,
  );

  return result.status === "ok"
    ? { status: "ok", items: result.data.items, total: result.data.total }
    : result;
}
