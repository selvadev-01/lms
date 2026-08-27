"use server";

import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Configuration import (Scenarios 59-62).
 *
 * # The document is not validated here
 *
 * Only that it is well-formed JSON of the expected outer shape. Whether each
 * VALUE is legal depends on its setting code, and the registry on the server is
 * the only thing that knows — the same reasoning that keeps `value` unparsed in
 * the settings action. Restating those rules here would create a second,
 * driftable copy that is enforced on the web only.
 *
 * # The per-entry problem list is surfaced, not summarized
 *
 * A refusal names every entry that cannot be applied. Collapsing that to "import
 * failed" would leave the operator to find the bad entries by bisection.
 */

const SERVICE = "Configuration";

export interface ImportProblem {
  settingCode: string;
  problem: string;
}

/**
 * `problems` rides alongside the usual action state so the form can list them.
 * A plain `message` cannot carry structure.
 */
export interface ImportActionState extends ActionState {
  problems?: ImportProblem[];
  result?: {
    applied: number;
    created: number;
    updated: number;
    unchanged: number;
    dryRun: boolean;
  };
}

export async function importConfigurationAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const raw = String(formData.get("document") ?? "").trim();
  const dryRun = formData.get("dryRun") === "on";

  if (!raw) {
    return { errors: { document: ["Paste a configuration document"] } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Caught here rather than sent on: the API would refuse it as a malformed
    // body with a message about the request, not about the document the user
    // is looking at.
    return {
      errors: {
        document: [
          "This is not valid JSON. Paste the exported document as-is.",
        ],
      },
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      errors: {
        document: ["A configuration document is a JSON object, not a list."],
      },
    };
  }

  const outcome = await call(
    "/settings/import",
    { method: "POST", body: { ...parsed, dryRun } },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();

  if (outcome.kind === "failed") {
    // A 400 from this endpoint carries `problems`, which the generic state
    // shape drops. Recover it so the form can list the offending entries.
    const problems = (
      outcome.state as ActionState & { problems?: ImportProblem[] }
    ).problems;
    return problems ? { ...outcome.state, problems } : outcome.state;
  }

  // `body` exists only on the ok branch; the failure paths returned above.
  const result =
    outcome.kind === "ok"
      ? (outcome.body as ImportActionState["result"])
      : undefined;

  revalidatePath("/admin/settings/organization");
  revalidatePath("/admin/settings/branch");
  revalidatePath("/admin/settings/transfer");

  return {
    success: result?.dryRun
      ? `Checked. ${result.created} would be created, ${result.updated} updated, ${result.unchanged} already match. Nothing was written.`
      : `Imported. ${result?.created ?? 0} created, ${result?.updated ?? 0} updated, ${result?.unchanged ?? 0} already matched.`,
    result,
  };
}
