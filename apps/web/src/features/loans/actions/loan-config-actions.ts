"use server";

import {
  createLoanProductSchema,
  createLoanSchemeSchema,
  createSchemeDurationSchema,
  setLoanConfigStatusSchema,
  updateLoanProductSchema,
  updateLoanSchemeSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Loan product and scheme configuration (Module 06).
 *
 * Every action here is Super-Admin-only in practice: the source is explicit that
 * Branch Admin is not a configuration owner, and the API's read/write permission
 * split is what enforces it. A Branch Admin reaching these forms is refused by
 * the server, not merely hidden from the button.
 */

const SERVICE = "Loan Configuration";
const UNAVAILABLE = `${SERVICE} is temporarily unavailable. Please try again shortly.`;

export async function createProductAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createLoanProductSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    loanType: formData.get("loanType"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/loan-products",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  // `endSession` returns `never`, but TS narrows on the discriminant rather than
  // on that, so the "session-ended" arm is still in the union here. Read the
  // body through a widened alias rather than restructuring the two guards, which
  // every other feature's actions share.
  const created = (outcome as { body?: unknown }).body as {
    loanProductId?: string;
  };
  revalidatePath("/loans/products");

  if (created.loanProductId) {
    redirect(`/loans/products/${created.loanProductId}`);
  }

  return { success: "Loan product created as a draft." };
}

export async function updateProductAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = formData.get("productId");

  if (typeof productId !== "string" || !productId) {
    return { message: UNAVAILABLE };
  }

  const parsed = updateLoanProductSchema.safeParse({
    name: formData.get("name"),
    loanType: formData.get("loanType"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-products/${encodeURIComponent(productId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/products/${productId}`);

  return { success: "Loan product updated." };
}

/**
 * Activate or deactivate a product.
 *
 * Deactivating stops new applications reaching any of its schemes. It does not
 * touch applications already created against them — those copied their terms at
 * creation, and Scenario 39 requires the copies to stand.
 */
export async function setProductStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = formData.get("productId");

  if (typeof productId !== "string" || !productId) {
    return { message: UNAVAILABLE };
  }

  const parsed = setLoanConfigStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-products/${encodeURIComponent(productId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/products/${productId}`);
  revalidatePath("/loans/products");

  return {
    success:
      parsed.data.status === "ACTIVE"
        ? "Loan product activated."
        : "Loan product withdrawn from lending.",
  };
}

export async function createSchemeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createLoanSchemeSchema.safeParse({
    loanProductId: formData.get("loanProductId"),
    code: formData.get("code"),
    name: formData.get("name"),
    interestType: formData.get("interestType"),
    interestRateBps: formData.get("interestRateBps"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/loan-schemes",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  // `endSession` returns `never`, but TS narrows on the discriminant rather than
  // on that, so the "session-ended" arm is still in the union here. Read the
  // body through a widened alias rather than restructuring the two guards, which
  // every other feature's actions share.
  const created = (outcome as { body?: unknown }).body as {
    loanSchemeId?: string;
  };
  revalidatePath("/loans/schemes");

  if (created.loanSchemeId) {
    redirect(`/loans/schemes/${created.loanSchemeId}`);
  }

  return { success: "Loan scheme created as a draft." };
}

export async function updateSchemeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const schemeId = formData.get("schemeId");

  if (typeof schemeId !== "string" || !schemeId) {
    return { message: UNAVAILABLE };
  }

  const parsed = updateLoanSchemeSchema.safeParse({
    name: formData.get("name"),
    interestType: formData.get("interestType"),
    interestRateBps: formData.get("interestRateBps"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-schemes/${encodeURIComponent(schemeId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/schemes/${schemeId}`);

  return {
    success: "Loan scheme updated. Existing applications keep their own terms.",
  };
}

/**
 * Activate or deactivate a scheme.
 *
 * Activation is refused by the API unless the scheme has at least one active
 * duration option — a scheme nothing can be borrowed over would appear in the
 * wizard's picker and then fail every submission against it.
 */
export async function setSchemeStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const schemeId = formData.get("schemeId");

  if (typeof schemeId !== "string" || !schemeId) {
    return { message: UNAVAILABLE };
  }

  const parsed = setLoanConfigStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-schemes/${encodeURIComponent(schemeId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/schemes/${schemeId}`);
  revalidatePath("/loans/schemes");

  return {
    success:
      parsed.data.status === "ACTIVE"
        ? "Loan scheme activated."
        : "Loan scheme withdrawn from new applications.",
  };
}

export async function addSchemeDurationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const schemeId = formData.get("schemeId");

  if (typeof schemeId !== "string" || !schemeId) {
    return { message: UNAVAILABLE };
  }

  const parsed = createSchemeDurationSchema.safeParse({
    frequency: formData.get("frequency"),
    durationCount: formData.get("durationCount"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-schemes/${encodeURIComponent(schemeId)}/durations`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/schemes/${schemeId}`);

  return { success: "Duration option added." };
}

/**
 * Deactivate or delete one duration option.
 *
 * Deletion is refused by the API when applications already use the term. There
 * is no foreign key to enforce that — an application stores the frequency and
 * count as values — so the guard is the only thing standing between a delete and
 * an orphaned term.
 */
export async function setDurationStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const schemeId = formData.get("schemeId");
  const durationId = formData.get("durationId");
  const intent = formData.get("intent");

  if (
    typeof schemeId !== "string" ||
    !schemeId ||
    typeof durationId !== "string" ||
    !durationId
  ) {
    return { message: UNAVAILABLE };
  }

  const path = `/loan-schemes/${encodeURIComponent(schemeId)}/durations/${encodeURIComponent(durationId)}`;

  const outcome =
    intent === "delete"
      ? await call(path, { method: "DELETE" }, SERVICE)
      : await call(
          path,
          {
            method: "PATCH",
            body: { status: intent === "activate" ? "ACTIVE" : "INACTIVE" },
          },
          SERVICE,
        );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/schemes/${schemeId}`);

  return {
    success:
      intent === "delete"
        ? "Duration option removed."
        : "Duration option updated.",
  };
}
