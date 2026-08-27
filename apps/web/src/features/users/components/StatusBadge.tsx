"use client";

import type { RoleLifecycleStatus, UserAccountStatus } from "@lms/types";
import { Badge } from "@lms/ui";
import React from "react";

/**
 * The colour vocabulary for account and role lifecycle states.
 *
 * Five account states and three role states is more than a two-colour
 * active/inactive scheme can carry, and the distinctions matter operationally:
 * `PENDING` is waiting on a password while `INACTIVE` was switched off
 * deliberately, and `LOCKED` clears itself while `SUSPENDED` does not. Rendering
 * all four as "not active" would hide exactly the difference an administrator
 * opened the screen to see.
 */
const ACCOUNT_COLOR: Record<
  UserAccountStatus,
  "success" | "warning" | "error" | "light"
> = {
  ACTIVE: "success",
  /** Provisioned, no password yet — waiting on someone, not switched off. */
  PENDING: "warning",
  /** Temporary and self-clearing; the authentication module owns it. */
  LOCKED: "warning",
  INACTIVE: "light",
  SUSPENDED: "error",
};

const ROLE_COLOR: Record<RoleLifecycleStatus, "success" | "warning" | "light"> =
  {
    ACTIVE: "success",
    /** Configurable but granting nothing yet — the pre-"Save & Activate" state. */
    DRAFT: "warning",
    INACTIVE: "light",
  };

export function AccountStatusBadge({ status }: { status: UserAccountStatus }) {
  return <Badge color={ACCOUNT_COLOR[status] ?? "light"}>{status}</Badge>;
}

export function RoleStatusBadge({ status }: { status: RoleLifecycleStatus }) {
  return <Badge color={ROLE_COLOR[status] ?? "light"}>{status}</Badge>;
}
