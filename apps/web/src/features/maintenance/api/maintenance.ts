import "server-only";

import type {
  MaintenanceJobDetail,
  MaintenanceModeDetail,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Module 17 — maintenance runs and maintenance mode.
 *
 * Failure detail on a run may be withheld by permission rather than absent
 * (Scenario 27). Each row carries `isFailureRedacted` saying which, because a
 * screen rendering "no failure detail" for a reader who simply may not see it
 * would misreport a failed run as unexplained.
 */

export type MaintenanceJobsResult =
  | { status: "ok"; jobs: MaintenanceJobDetail[] }
  | FetchFailure;

export type MaintenanceJobResult =
  | { status: "ok"; job: MaintenanceJobDetail }
  | { status: "not-found" }
  | FetchFailure;

export type MaintenanceModeResult =
  | { status: "ok"; modes: MaintenanceModeDetail[] }
  | FetchFailure;

export async function fetchMaintenanceJobs(
  options: { jobType?: string; status?: string; businessDate?: string } = {},
): Promise<MaintenanceJobsResult> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value) params.set(key, value);
  }

  const query = params.toString();
  const result = await apiGet<{ items: MaintenanceJobDetail[] }>(
    `/maintenance/jobs${query ? `?${query}` : ""}`,
  );

  return result.status === "ok" ? { status: "ok", jobs: result.data.items } : result;
}

export async function fetchMaintenanceJob(
  jobRunId: string,
): Promise<MaintenanceJobResult> {
  const result = await apiGetRecord<MaintenanceJobDetail>(
    `/maintenance/jobs/${jobRunId}`,
  );

  return result.status === "ok" ? { status: "ok", job: result.data } : result;
}

export async function fetchMaintenanceMode(): Promise<MaintenanceModeResult> {
  const result = await apiGet<{ items: MaintenanceModeDetail[] }>(
    "/maintenance/mode",
  );

  return result.status === "ok" ? { status: "ok", modes: result.data.items } : result;
}
