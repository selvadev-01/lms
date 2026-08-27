"use server";

import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Module 17 — maintenance runs and maintenance mode.
 *
 * # A duplicate EOD is a success, not an error
 *
 * `runEodAction` reports `ALREADY_HANDLED` as a distinct outcome rather than a
 * failure. A run already claimed for today is the designed result of the
 * idempotency key (Scenarios 22, 66), and presenting it as an error would train
 * operators to retry something that is already done.
 */

const SERVICE = "Maintenance";

function revalidateMaintenance(): void {
  revalidatePath("/admin/maintenance/jobs");
  revalidatePath("/admin/maintenance/eod");
  revalidatePath("/admin/settings/operational");
}

export async function runEodAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const businessDate = String(formData.get("businessDate") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "").trim();

  const outcome = await call(
    "/maintenance/eod",
    {
      method: "POST",
      body: {
        ...(businessDate ? { businessDate } : {}),
        // An empty select means organization-wide, which is an explicit null
        // rather than an omission — omitting it would fall back to the caller's
        // own branch and quietly run a narrower job than was asked for.
        branchId: branchId || null,
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateMaintenance();

  // `body` exists only on the ok branch; the failure paths returned above.
  const result = outcome.kind === "ok"
    ? (outcome.body as { outcome?: string } | undefined)
    : undefined;
  return {
    success:
      result?.outcome === "ALREADY_HANDLED"
        ? "End of day was already run for this date. Nothing was processed twice."
        : "End of day started.",
  };
}

export async function retryMaintenanceJobAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobRunId = String(formData.get("jobRunId") ?? "");
  if (!jobRunId) return { message: "Select a job to retry." };

  const outcome = await call(
    `/maintenance/jobs/${jobRunId}/retry`,
    { method: "POST", body: {} },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  // A 409 here means the job is not retryable — terminal and requiring
  // operational recovery (Scenario 31). The server's message says which.
  if (outcome.kind === "failed") return outcome.state;

  revalidateMaintenance();
  return {
    success: "Retry started. Steps that already succeeded were not repeated.",
  };
}

export async function setMaintenanceModeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const enabled = formData.get("enabled") === "on";
  const reason = String(formData.get("reason") ?? "").trim();
  const userMessage = String(formData.get("userMessage") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "").trim();
  const rawVersion = formData.get("expectedVersion");

  // Mandatory in BOTH directions (Rule 77): "why is the system down" and "why
  // did somebody turn the block off" are equally worth recording.
  if (!reason) {
    return { errors: { reason: ["Reason is required"] } };
  }

  const outcome = await call(
    "/maintenance/mode",
    {
      method: "PUT",
      body: {
        enabled,
        reason,
        branchId: branchId || null,
        ...(userMessage ? { userMessage } : {}),
        ...(rawVersion ? { expectedVersion: Number(rawVersion) } : {}),
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateMaintenance();
  return {
    success: enabled
      ? "Maintenance mode enabled. It may take up to a minute to apply across all servers."
      : "Maintenance mode disabled. It may take up to a minute to apply across all servers.",
  };
}
