"use client";

import type { RoleSummary } from "@lms/types";
import { Alert, Button, Modal } from "@lms/ui";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { useModal } from "@/hooks/useModal";
import {
  deleteRoleAction,
  setRoleStatusAction,
  type RoleFormState,
} from "../actions/role-actions";
import { RoleStatusBadge } from "./StatusBadge";

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export interface RoleListProps {
  roles: RoleSummary[];
  loadError?: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canActivate: boolean;
}

/**
 * Role & Permission Management.
 *
 * A system role shows no lifecycle controls at all. That is not only cosmetic:
 * the API refuses to rename, deactivate or delete one, so offering the buttons
 * would invite a click that can only fail. The badge in the Name column is what
 * explains why they are missing.
 */
export default function RoleList({
  roles,
  loadError,
  canCreate,
  canUpdate,
  canDelete,
  canActivate,
}: RoleListProps) {
  const [statusState, statusAction] = useActionState<RoleFormState, FormData>(
    setRoleStatusAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<RoleFormState, FormData>(
    deleteRoleAction,
    {},
  );

  const { isOpen, openModal, closeModal } = useModal();
  const [target, setTarget] = useState<RoleSummary | null>(null);

  const message = deleteState.message ?? statusState.message;
  const success = deleteState.success ?? statusState.success;
  const blockedBy = deleteState.blockedBy;

  if (loadError) {
    return (
      <div role="alert" aria-live="assertive">
        <Alert
          variant="error"
          title="Roles unavailable"
          message="We could not load your roles. Please try again shortly."
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

      {blockedBy && blockedBy.length > 0 ? (
        <Alert
          variant="warning"
          title="Deactivate this role instead"
          message={`It is held by ${blockedBy
            .map((blocker) => `${blocker.count} ${blocker.label.toLowerCase()}`)
            .join(", ")}. Deleting it would remove their access.`}
        />
      ) : null}

      {canCreate ? (
        <div className="flex justify-end">
          <Link href="/roles/new">
            <Button size="sm">Create role</Button>
          </Link>
        </div>
      ) : null}

      {roles.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          There are no roles in your organization yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Roles within your organization
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
                  Permissions
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Users
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
              {roles.map((role) => {
                const active = role.status === "ACTIVE";

                return (
                  <tr
                    key={role.roleId}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td className="px-4 py-3 font-medium">{role.code}</td>
                    <td className="px-4 py-3">
                      {canUpdate ? (
                        <Link
                          href={`/roles/${role.roleId}`}
                          className="text-brand-500 hover:underline"
                        >
                          {role.name}
                        </Link>
                      ) : (
                        role.name
                      )}
                      {role.isSystem ? (
                        <span className="ml-2 text-xs text-gray-400">
                          system role
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{role.permissionCount}</td>
                    <td className="px-4 py-3">{role.assignedUserCount}</td>
                    <td className="px-4 py-3">
                      <RoleStatusBadge status={role.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {/*
                          A system role cannot be deactivated or deleted, so it
                          gets no controls — the API would refuse either.
                        */}
                        {canActivate && !role.isSystem ? (
                          <form action={statusAction}>
                            <input
                              type="hidden"
                              name="roleId"
                              value={role.roleId}
                            />
                            <input
                              type="hidden"
                              name="status"
                              value={active ? "INACTIVE" : "ACTIVE"}
                            />
                            <SubmitButton
                              label={active ? "Deactivate" : "Activate"}
                              busy={active ? "Deactivating…" : "Activating…"}
                            />
                          </form>
                        ) : null}

                        {canDelete && !role.isSystem ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTarget(role);
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
        <h3 className="mb-2 text-lg font-medium text-gray-800 dark:text-white/90">
          Delete {target?.name}?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          This cannot be undone, and it is only possible while no user holds the
          role. Deactivating stops it granting anything without disturbing
          existing assignments.
        </p>
        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <form
            action={deleteAction}
            onSubmit={() => {
              closeModal();
            }}
          >
            <input type="hidden" name="roleId" value={target?.roleId ?? ""} />
            <SubmitButton label="Delete" busy="Deleting…" />
          </form>
        </div>
      </Modal>
    </div>
  );
}
