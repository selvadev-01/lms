"use server";

import { recordCreditAssessmentSchema } from "@lms/validation";
import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Credit assessment mutations (Module 08).
 *
 * Separate from `loan-application-actions.ts` for the same reason the API keeps
 * a separate controller: recording an assessment is not a lifecycle transition.
 * It posts to a nested resource rather than a verb, and it carries no
 * `expectedVersion` — the application's row is untouched, so there is no
 * version to be stale against.
 */

const SERVICE = "Credit Assessment";

export async function recordCreditAssessmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = formData.get("applicationId");

  if (typeof applicationId !== "string" || !applicationId) {
    return {
      message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
    };
  }

  const parsed = recordCreditAssessmentSchema.safeParse({
    cibilScore: formData.get("cibilScore"),
    incomeVerified: formData.get("incomeVerified"),
    incomeMonthlyPaise: formData.get("incomeMonthlyPaise"),
    assessmentResult: formData.get("assessmentResult"),
    assessmentNotes: formData.get("assessmentNotes"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-applications/${encodeURIComponent(applicationId)}/credit-assessment`,
    {
      method: "POST",
      body: {
        ...parsed.data,
        // The schema keeps this as the literal string the form sent, because
        // `z.coerce.boolean()` would turn "false" into `true`. The conversion
        // happens here, once, where it is visible.
        incomeVerified: parsed.data.incomeVerified === "true",
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/applications/${applicationId}`);

  return { success: "Credit assessment recorded." };
}
