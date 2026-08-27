"use client";

import { Alert } from "@lms/ui";
import type { ConfigurationExport } from "@lms/types";
import React, { useActionState, useState } from "react";

import { SubmitButton } from "@/components/form/FormFields";

import { importConfigurationAction } from "../actions/config-transfer-actions";

/**
 * Configuration import and export (Scenarios 59-62).
 *
 * # The export is shown, not offered as a download
 *
 * A `<a download>` and a script-driven save are both inert inside the artifact
 * and app-shell sandboxes this runs in, so a download button would look like it
 * worked and produce nothing. The document is rendered for copying instead,
 * which always works.
 *
 * # Dry run is the default
 *
 * An import rewrites configuration in bulk. Checking first costs one round trip
 * and reports exactly what would change, so it is the pre-ticked option rather
 * than something to remember.
 */
export default function ConfigTransferPanel({
  document,
  loadError = false,
  canImport = false,
}: {
  document: ConfigurationExport | null;
  loadError?: boolean;
  canImport?: boolean;
}) {
  const [state, action] = useActionState(importConfigurationAction, {});
  const [copied, setCopied] = useState(false);

  const serialized = document ? JSON.stringify(document, null, 2) : "";
  const maskedCount =
    document?.settings.filter((s) => s.isValueMasked).length ?? 0;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(serialized);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (permissions, insecure context). The
      // textarea below is still selectable, so this is a convenience failing,
      // not the feature failing — saying nothing beats a scary error.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Export
        </h3>

        {loadError ? (
          <Alert
            variant="error"
            title="Configuration unavailable"
            message="We could not read the configuration. Refresh to try again."
          />
        ) : (
          <>
            {maskedCount > 0 ? (
              // Rule 56 — saying so matters: a document imported elsewhere with
              // masked entries is refused by name, and the operator should learn
              // that here rather than from the refusal.
              <Alert
                variant="info"
                title="Some values are withheld"
                message={`${maskedCount} protected setting(s) were exported without their values because you do not have permission to read them. Importing this document elsewhere will refuse those entries.`}
              />
            ) : null}

            <textarea
              readOnly
              value={serialized}
              rows={12}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={copy}
                className="text-xs font-medium text-brand-500 hover:underline"
              >
                Copy to clipboard
              </button>
              {copied ? (
                <span className="text-xs text-success-600">Copied.</span>
              ) : null}
            </div>
          </>
        )}
      </section>

      {canImport ? (
        <section className="space-y-3 border-t border-gray-200 pt-5 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
            Import
          </h3>

          {state.success ? (
            <Alert variant="success" title="Done" message={state.success} />
          ) : null}
          {state.message ? (
            <Alert
              variant="error"
              title="Not imported"
              message={state.message}
            />
          ) : null}

          {/* Scenario 60 — every entry that cannot be applied, so one round trip
              tells the operator all of it. */}
          {state.problems && state.problems.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-error-200 bg-error-50 p-3 text-xs dark:border-error-500/30 dark:bg-error-500/10">
              {state.problems.map((problem) => (
                <li key={`${problem.settingCode}:${problem.problem}`}>
                  <span className="font-mono font-medium">
                    {problem.settingCode}
                  </span>
                  {" — "}
                  {problem.problem}
                </li>
              ))}
            </ul>
          ) : null}

          <form action={action} className="space-y-3">
            <label
              htmlFor="document"
              className="block text-sm text-gray-700 dark:text-gray-300"
            >
              Configuration document
            </label>
            <textarea
              id="document"
              name="document"
              rows={10}
              placeholder='{"schemaVersion":1,"settings":[…]}'
              className="w-full rounded-lg border border-gray-200 p-3 font-mono text-xs dark:border-gray-800 dark:bg-gray-900"
            />
            {state.errors?.document ? (
              <p className="text-xs text-error-500">
                {state.errors.document[0]}
              </p>
            ) : null}

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" name="dryRun" defaultChecked />
              Check only — report what would change without writing anything
            </label>

            <SubmitButton label="Import" pendingLabel="Importing…" />
          </form>
        </section>
      ) : null}
    </div>
  );
}
