"use server";

import {
  createCashHandoverSchema,
  receiveCashHandoverSchema,
  reverseCashHandoverSchema,
  submitCashHandoverSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Cash handover mutations (Module 12).
 *
 * Four authorities, four functions. The split that matters most is submit
 * versus receive: they are the two sides of one transfer, held by different
 * people, and one function branching at runtime would put both in reach of
 * whoever could call it (Scenario 43).
 *
 * # Two idempotency conventions
 *
 * `createCashHandoverAction` sends its key in the **body** — it identifies the
 * handover being created, and the form mints it before the row exists.
 * `receiveCashHandoverAction` sends one as an **`Idempotency-Key` header** via
 * `call`'s option — it identifies a retry of an operation against a row that
 * already exists. That is the split the codebase draws throughout; following it
 * means a reader who knows one knows both.
 */

export interface CashHandoverFormState extends ActionState {
  /** Populated when the API refused on a balance or prefix gate. */
  blockers?: { key: string; reason: string; details?: unknown }[];
  /** The amounts a handover may legitimately name, when one was refused. */
  handoverableAmounts?: string[];
}

const SERVICE = "Cash Handover";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

function withRefusalDetail(state: ActionState): CashHandoverFormState {
  const blockers = (state as { blockers?: unknown }).blockers;

  const amounts = Array.isArray(blockers)
    ? (
        blockers as {
          details?: { handoverableAmounts?: unknown };
        }[]
      ).find((blocker) => Array.isArray(blocker.details?.handoverableAmounts))
        ?.details?.handoverableAmounts
    : undefined;

  return {
    ...state,
    ...(Array.isArray(blockers)
      ? {
          blockers: blockers as {
            key: string;
            reason: string;
            details?: unknown;
          }[],
        }
      : {}),
    ...(Array.isArray(amounts)
      ? { handoverableAmounts: amounts as string[] }
      : {}),
  };
}

function revalidate(handoverId?: string): void {
  revalidatePath("/field/cash-handovers");
  revalidatePath("/field/collections");
  if (handoverId) revalidatePath(`/field/cash-handovers/${handoverId}`);
}

/** Scenario 22 — draft a handover of the agent's own collected cash. */
export async function createCashHandoverAction(
  _previous: CashHandoverFormState,
  formData: FormData,
): Promise<CashHandoverFormState> {
  const parsed = createCashHandoverSchema.safeParse({
    handedOverCashPaise: formData.get("handedOverCashPaise"),
    notes: formData.get("notes") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/field/cash-handovers",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  const created = (outcome as { body?: unknown }).body as {
    handoverId?: string;
  };

  if (!created.handoverId) return UNAVAILABLE;

  revalidate();
  redirect(`/field/cash-handovers/${created.handoverId}`);
}

/** Submit a draft for the branch to receive. */
export async function submitCashHandoverAction(
  _previous: CashHandoverFormState,
  formData: FormData,
): Promise<CashHandoverFormState> {
  const value = formData.get("handoverId");
  const handoverId = typeof value === "string" && value ? value : null;
  if (!handoverId) return UNAVAILABLE;

  const parsed = submitCashHandoverSchema.safeParse({
    acknowledgmentReference:
      formData.get("acknowledgmentReference") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/field/cash-handovers/${encodeURIComponent(handoverId)}/submit`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidate(handoverId);

  return {
    success: "Handover submitted. The branch can now receive the cash.",
  };
}

/**
 * Scenarios 23, 24 — receive the cash at the branch.
 *
 * The act that posts the custody journal. The idempotency key travels as a
 * header because it identifies a retry against a row that already exists; the
 * form mints it once per mount and passes it through `idempotencyKey`.
 */
export async function receiveCashHandoverAction(
  _previous: CashHandoverFormState,
  formData: FormData,
): Promise<CashHandoverFormState> {
  const value = formData.get("handoverId");
  const handoverId = typeof value === "string" && value ? value : null;
  if (!handoverId) return UNAVAILABLE;

  const keyValue = formData.get("idempotencyKey");
  const idempotencyKey =
    typeof keyValue === "string" && keyValue ? keyValue : null;
  if (!idempotencyKey) return UNAVAILABLE;

  const parsed = receiveCashHandoverSchema.safeParse({
    receivedCashPaise: formData.get("receivedCashPaise"),
    notes: formData.get("notes") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/field/cash-handovers/${encodeURIComponent(handoverId)}/receive`,
    { method: "POST", body: parsed.data, idempotencyKey },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidate(handoverId);

  return {
    success:
      "Cash received. The custody transfer has been posted to the ledger.",
  };
}

/**
 * Reverse a received handover.
 *
 * Behind its own permission, which a Branch Admin does not hold. Releases the
 * claim on the underlying collections, so the agent's derived balance returns
 * to what it was.
 */
export async function reverseCashHandoverAction(
  _previous: CashHandoverFormState,
  formData: FormData,
): Promise<CashHandoverFormState> {
  const value = formData.get("handoverId");
  const handoverId = typeof value === "string" && value ? value : null;
  if (!handoverId) return UNAVAILABLE;

  const parsed = reverseCashHandoverSchema.safeParse({
    reversalReason: formData.get("reversalReason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/field/cash-handovers/${encodeURIComponent(handoverId)}/reverse`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidate(handoverId);

  return {
    success:
      "Handover reversed. The cash is back in the agent's custody and the original entry is preserved.",
  };
}
