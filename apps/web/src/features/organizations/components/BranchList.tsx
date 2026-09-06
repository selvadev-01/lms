"use client";

import type { BranchSummary } from "@lms/types";
import { Alert, Badge, Button, Modal } from "@lms/ui";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { useModal } from "@/hooks/useModal";
import {
  deleteBranchAction,
  setBranchStatusAction,
  type BranchFormState,
} from "../actions/branch-actions";

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export interface BranchListProps {
  branches: BranchSummary[];
  /** Set when the list could not be loaded, as opposed to being empty. */
  loadError?: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canActivate: boolean;
}

/**
 * Branch Management.
 *
 * Controls are hidden according to the caller's permissions, but that is
 * presentation only — a Branch Admin who forged a request would still be
 * refused by the API, which re-checks every permission and confines every query
 * to the caller's own branch. Hiding a button they cannot use keeps the screen
 * honest; it is not what makes it safe.
 */
export default function BranchList({
  branches,
  loadError,
  canCreate,
  canUpdate,
  canDelete,
  canActivate,
}: BranchListProps) {
  const [statusState, statusAction] = useActionState<BranchFormState, FormData>(
    setBranchStatusAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<BranchFormState, FormData>(
    deleteBranchAction,
    {},
  );

  const { isOpen, openModal, closeModal } = useModal();
  const [target, setTarget] = useState<BranchSummary | null>(null);

  const message = deleteState.message ?? statusState.message;
  const success = deleteState.success ?? statusState.success;
  const blockedBy = deleteState.blockedBy;

  if (loadError) {
    return (
      <div role="alert" aria-live="assertive">
        <Alert
          variant="error"
          title="Branches unavailable"
          message="We could not load your branches. Please try again shortly."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div role="alert" aria-live="assertive">
        {message ? (
          <Alert
            variant="error"
            title="Action not completed"
            message={message}
          />
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {success ? (
          <Alert variant="success" title="Done" message={success} />
        ) : null}
      </div>

      {/*
        The blocker list is what turns "you cannot delete this" into advice the
        user can act on (Scenario 30). Without it the refusal is a dead end.
      */}
      {blockedBy && blockedBy.length > 0 ? (
        <Alert
          variant="warning"
          title="Deactivate this branch instead"
          message={`It is referenced by ${blockedBy
            .map((blocker) => `${blocker.count} ${blocker.label.toLowerCase()}`)
            .join(", ")}. Deleting it would break those records.`}
        />
      ) : null}

      {canCreate ? (
        <div className="flex justify-end">
          <Link href="/branches/new">
            <Button type="button" size="sm">
              Add branch
            </Button>
          </Link>
        </div>
      ) : null}

      {branches.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          There are no branches in your scope yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Branches within your organization
            </caption>
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Code
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Location
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => {
                const inactive = branch.status === "INACTIVE";

                return (
                  <tr
                    key={branch.branchId}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td className="px-4 py-3 font-medium">{branch.code}</td>
                    <td className="px-4 py-3">
                      {canUpdate ? (
                        <Link
                          href={`/branches/${branch.branchId}`}
                          className="text-brand-500 hover:underline"
                        >
                          {branch.name}
                        </Link>
                      ) : (
                        branch.name
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {branch.city}, {branch.state}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={inactive ? "light" : "success"}>
                        {branch.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canActivate ? (
                          <form action={statusAction}>
                            <input
                              type="hidden"
                              name="branchId"
                              value={branch.branchId}
                            />
                            <input
                              type="hidden"
                              name="status"
                              value={inactive ? "ACTIVE" : "INACTIVE"}
                            />
                            <SubmitButton
                              label={inactive ? "Activate" : "Deactivate"}
                              busy={inactive ? "Activating…" : "Deactivating…"}
                            />
                          </form>
                        ) : null}

                        {canDelete ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTarget(branch);
                              openModal();
                            }}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-md p-6">
        <h2 className="mb-2 text-lg font-semibold">Delete this branch?</h2>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {target
            ? `${target.code} — ${target.name} will be permanently removed. This cannot be undone, and it is refused if any record still references the branch.`
            : ""}
        </p>
        <form
          action={deleteAction}
          onSubmit={() => closeModal()}
          className="flex justify-end gap-3"
        >
          <input type="hidden" name="branchId" value={target?.branchId ?? ""} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={closeModal}
          >
            Cancel
          </Button>
          <SubmitButton label="Delete branch" busy="Deleting…" />
        </form>
      </Modal>
    </div>
  );
}
