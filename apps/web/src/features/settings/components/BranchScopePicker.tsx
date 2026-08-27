"use client";

import { Alert } from "@lms/ui";
import type { BranchSummary } from "@lms/types";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";

import { SelectField } from "@/components/form/FormFields";

/**
 * Branch selector for the branch settings screen.
 *
 * The choice lives in the query string rather than component state so the
 * selected branch survives a refresh and can be linked to directly — the page
 * is a server component that reads `branchId` from `searchParams`, so a purely
 * local selection would not change what it fetches.
 */
export default function BranchScopePicker({
  branches,
  selectedBranchId,
  loadError = false,
}: {
  branches: BranchSummary[];
  selectedBranchId?: string;
  loadError?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Branches unavailable"
        message="We could not load the branch list. Refresh to try again."
      />
    );
  }

  function selectBranch(branchId: string): void {
    const next = new URLSearchParams(searchParams.toString());
    if (branchId) {
      next.set("branchId", branchId);
    } else {
      next.delete("branchId");
    }
    router.replace(`?${next.toString()}`);
  }

  return (
    <div className="max-w-sm">
      <SelectField
        name="branchId"
        label="Branch"
        placeholder="Choose a branch…"
        options={branches.map((branch) => ({
          value: branch.branchId,
          label: `${branch.code} — ${branch.name}`,
        }))}
        value={selectedBranchId ?? ""}
        onChange={selectBranch}
      />
    </div>
  );
}
