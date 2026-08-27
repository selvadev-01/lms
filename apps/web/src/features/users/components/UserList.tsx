"use client";

import type { UserSummary } from "@lms/types";
import { Alert, Button, Modal } from "@lms/ui";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { useModal } from "@/hooks/useModal";
import {
  deleteUserAction,
  setUserStatusAction,
  type UserFormState,
} from "../actions/user-actions";
import {
  deleteEmployeeAction,
  setEmployeeStatusAction,
} from "../actions/employee-actions";
import { AccountStatusBadge } from "./StatusBadge";

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export interface UserListProps {
  users: UserSummary[];
  /** Which surface this list is showing — decides the routes and the wording. */
  surface: "USER" | "EMPLOYEE";
  /** Set when the list could not be loaded, as opposed to being empty. */
  loadError?: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canActivate: boolean;
}

/**
 * Admin Management and Employee Management.
 *
 * One component for both, parameterised by `surface`, because the two lists are
 * the same table rendered through different permissions — the columns differ
 * only in whether Employee ID and Branch are worth showing.
 *
 * Controls are hidden according to the caller's permissions, but that is
 * presentation only. The API re-checks every permission and confines every query
 * to the caller's branch; hiding a button they cannot use keeps the screen
 * honest, it is not what makes it safe.
 *
 * Delete is deliberately the secondary action and Deactivate the primary one.
 * Anyone who has ever signed in is referenced by an audit row and therefore
 * permanently undeletable, so a UI leading with Delete would mostly produce
 * refusals — the opposite of what the story wants (Rules 43–45).
 */
export default function UserList({
  users,
  surface,
  loadError,
  canCreate,
  canUpdate,
  canDelete,
  canActivate,
}: UserListProps) {
  const isEmployee = surface === "EMPLOYEE";
  const basePath = isEmployee ? "/employees" : "/users";
  const noun = isEmployee ? "employee" : "user";

  const [statusState, statusAction] = useActionState<UserFormState, FormData>(
    isEmployee ? setEmployeeStatusAction : setUserStatusAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<UserFormState, FormData>(
    isEmployee ? deleteEmployeeAction : deleteUserAction,
    {},
  );

  const { isOpen, openModal, closeModal } = useModal();
  const [target, setTarget] = useState<UserSummary | null>(null);

  const message = deleteState.message ?? statusState.message;
  const success = deleteState.success ?? statusState.success;
  const blockedBy = deleteState.blockedBy;

  if (loadError) {
    return (
      <div role="alert" aria-live="assertive">
        <Alert
          variant="error"
          title={isEmployee ? "Employees unavailable" : "Users unavailable"}
          message={`We could not load your ${noun}s. Please try again shortly.`}
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
        What turns "you cannot delete this" into advice (Scenarios 54, 55).
        Without it the refusal is a dead end, and for users it is the common case
        rather than the exception.
      */}
      {blockedBy && blockedBy.length > 0 ? (
        <Alert
          variant="warning"
          title={`Deactivate this ${noun} instead`}
          message={`They are referenced by ${blockedBy
            .map((blocker) => `${blocker.count} ${blocker.label.toLowerCase()}`)
            .join(", ")}. Deleting them would break those records.`}
        />
      ) : null}

      {canCreate ? (
        <div className="flex justify-end">
          <Link href={`${basePath}/new`}>
            <Button size="sm">
              {isEmployee ? "Add employee" : "Add user"}
            </Button>
          </Link>
        </div>
      ) : null}

      {users.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          There are no {noun}s in your scope yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              {isEmployee
                ? "Employees within your scope"
                : "Administrator accounts within your scope"}
            </caption>
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr>
                {isEmployee ? (
                  <th scope="col" className="px-4 py-3 font-medium">
                    Employee ID
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Mobile
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Branch
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Roles
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
              {users.map((user) => {
                const active = user.status === "ACTIVE";

                return (
                  <tr
                    key={user.userId}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    {isEmployee ? (
                      <td className="px-4 py-3 font-medium">
                        {user.employeeCode}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      {canUpdate ? (
                        <Link
                          href={`${basePath}/${user.userId}`}
                          className="text-brand-500 hover:underline"
                        >
                          {user.name}
                        </Link>
                      ) : (
                        user.name
                      )}
                    </td>
                    <td className="px-4 py-3">{user.mobile ?? "—"}</td>
                    <td className="px-4 py-3">
                      {/* An organization-wide administrator has no branch. */}
                      {user.branchName ?? "All branches"}
                    </td>
                    <td className="px-4 py-3">
                      {user.roles.join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <AccountStatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canActivate ? (
                          <form action={statusAction}>
                            <input
                              type="hidden"
                              name="userId"
                              value={user.userId}
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

                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTarget(user);
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
          This cannot be undone, and it is only possible for an account that has
          never been used. Deactivating keeps their history intact and is
          reversible.
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
            <input type="hidden" name="userId" value={target?.userId ?? ""} />
            <SubmitButton label="Delete" busy="Deleting…" />
          </form>
        </div>
      </Modal>
    </div>
  );
}
