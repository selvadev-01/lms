import type { Role } from "@lms/types";

/**
 * Landing route after a successful sign-in.
 *
 * Super Admin reaches the system-wide dashboard while a Branch Admin reaches
 * the branch dashboard, per the Sign-In story (Scenarios 1 and 5). Order
 * matters: the most privileged matching role wins when a user holds several.
 */
export function dashboardPathFor(
  roles: readonly Role[] | readonly string[],
): string {
  if (roles.includes("SUPER_ADMIN")) return "/";
  if (roles.includes("BRANCH_ADMIN")) return "/branch";
  if (roles.includes("FIELD_EMPLOYEE")) return "/field";
  return "/";
}
