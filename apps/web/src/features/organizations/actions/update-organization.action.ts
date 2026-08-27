"use server";

import { updateOrganizationSchema } from "@lms/validation";
import { revalidatePath } from "next/cache";

import { call, endSession } from "@/lib/api-call";

export interface UpdateOrganizationState {
  message?: string;
  success?: string;
  errors?: {
    name?: string[];
    legalName?: string[];
    timezone?: string[];
  };
}

/**
 * Saves Company Settings (Module 02 Scenario 6).
 *
 * The organization is never named in the request: the API resolves it from the
 * session, so there is no field here through which another tenant could be
 * reached.
 */
export async function updateOrganizationAction(
  _previous: UpdateOrganizationState,
  formData: FormData,
): Promise<UpdateOrganizationState> {
  const parsed = updateOrganizationSchema.safeParse({
    name: formData.get("name"),
    legalName: formData.get("legalName"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  /**
   * `call` names the service in its own fallback and outage messages, so the
   * previous hand-rolled copy ("Company Settings are temporarily unavailable")
   * is reproduced rather than lost. Its 400/409 handling is an improvement on
   * what stood here: the API's own message now reaches the user instead of a
   * generic outage line.
   */
  const outcome = await call(
    "/organizations/me",
    { method: "PATCH", body: parsed.data },
    "Company Settings",
  );

  /**
   * `endSession` clears the cookies and redirects; `redirect` signals by
   * throwing, which is why it is called here rather than inside any try.
   */
  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/company-settings");
  return { success: "Company Settings saved." };
}
