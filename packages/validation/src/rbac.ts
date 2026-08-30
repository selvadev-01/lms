import { z } from "zod";

import { optionsFrom } from "./options";
// Direct module import, not via the barrel: ./index re-exports this file, so
// going through it would be a cycle.
import { PASSWORD_MIN_LENGTH } from "./password-policy";
import { emailSchema, idSchema, mobileField, optionalText } from "./primitives";

/**
 * Module 03 schemas — users, employees, roles and permissions.
 *
 * Split out of `index.ts` following the `password-policy.ts` precedent, and
 * re-exported from there so both apps keep a single import surface.
 *
 * The import above reaches for `./primitives`, not `./index`, and must keep doing
 * so. `index.ts` re-exports this file from its last line, so importing from it
 * here would be a cycle — and a live one, not a benign type-only one: loading
 * `index` would begin evaluating this module, which calls `optionalText` at
 * module scope while the `const` binding it is still uninitialized. That fails at
 * runtime with "optionalText is not a function".
 *
 * Two conventions run through every schema here:
 *
 * 1. **No scope fields.** No `orgId`, and no `branchId` on anything a caller
 *    could use to widen their own reach. Organization comes from the JWT, so
 *    Scenario 4 ("a user cannot be created outside the authorized organization")
 *    is structural rather than a check that could be forgotten. The API's
 *    `forbidNonWhitelisted` turns an attempt to send one into a 400.
 *
 * 2. **One field, one endpoint.** Status, roles, branch and mobile are each
 *    absent from the update schemas because each has its own route and its own
 *    permission. An administrator who may rename a user is not thereby allowed
 *    to deactivate them, and the schema is where that separation starts.
 *
 * Mandatory-field messages match the story's Scenario Outline verbatim, because
 * the e2e specs assert on the rendered text.
 */

/**
 * Employee code. Same character class as `branchCodeSchema` and for the same
 * reason: it appears in URLs and exports, so it stays to what survives both
 * unescaped.
 */
export const employeeCodeSchema = z
  .string()
  .trim()
  .min(1, "Employee ID is required")
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Enter a valid Employee ID");

/**
 * Role code. Upper-snake, matching the seeded `SUPER_ADMIN` / `BRANCH_ADMIN`
 * shape, because a role code is compared in code and read in audit logs — a
 * mixed-case or punctuated one would make both ambiguous. Immutable once
 * created, so this only ever validates a create.
 */
export const roleCodeSchema = z
  .string()
  .trim()
  .min(1, "Role Code is required")
  .max(100)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Role Code must be uppercase letters, digits and underscores",
  );

export const userStatusSchema = z.enum([
  "ACTIVE",
  "INACTIVE",
  "LOCKED",
  "SUSPENDED",
  "PENDING",
]);

export const roleStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE"]);

/**
 * Option registries for Module 03.
 *
 * `USER_STATUS_OPTIONS` lists all five states, not the two a create form offers.
 * Narrowing belongs at the call site via `pick(...)` — user creation offers only
 * PENDING and INACTIVE because the other three are reached by acting on an
 * account rather than by choosing them, and that intent should be visible where
 * the decision is made rather than hidden in the shared registry.
 */
export const USER_STATUS_OPTIONS = optionsFrom(userStatusSchema.options, {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  LOCKED: "Locked",
  SUSPENDED: "Suspended",
  PENDING: "Pending",
});

export const ROLE_STATUS_OPTIONS = optionsFrom(roleStatusSchema.options, {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
});

/**
 * Branch and organization lifecycle. A plain two-value list, declared once here
 * rather than as `<option>` JSX repeated in each form that edits a record.
 */
export const RECORD_STATUS_OPTIONS = optionsFrom(
  z.enum(["ACTIVE", "INACTIVE"]).options,
  { ACTIVE: "Active", INACTIVE: "Inactive" },
);

/**
 * The roles a user holds, as a set.
 *
 * `min(1)` because Rule 19 makes role assignment explicit: an account with no
 * role grants nothing and cannot be reasoned about, so it is not a state the
 * forms may produce. The message is the story's, which names the singular field
 * the form actually shows.
 */
const roleIdsField = z
  .array(idSchema)
  .min(1, "Role is required")
  .max(20, "Too many roles selected");

/**
 * Administrator create.
 *
 * `branchId` IS accepted here, unlike on the employee form, because assigning an
 * administrator to a branch is what makes them a Branch Admin rather than an
 * organization-wide one — it narrows their reach, so a caller naming it cannot
 * widen anything. The service still refuses a branch outside the actor's own
 * scope (Scenario 18).
 *
 * `status` is accepted but the service constrains it: a freshly created account
 * has no password, so ACTIVE would mean "live account nobody can sign in to".
 * Supplying `password` is what makes ACTIVE truthful, and the service promotes
 * the account itself rather than trusting the status the form sent.
 *
 * `password` is optional. Omitting it keeps the older behaviour — no credential,
 * account PENDING — which is still the right answer when the person will set
 * their own. Supplying one activates the account immediately and forces a change
 * at first sign-in, because a password an administrator typed is known to two
 * people until the user replaces it.
 *
 * `confirmPassword` never leaves the browser. It catches a typo in a masked
 * field; the API receives one password and either accepts it or does not.
 */
const createUserFields = {
  name: z.string().trim().min(1, "Full Name is required").max(200),
  mobile: mobileField,
  email: optionalText(320).pipe(emailSchema.optional()),
  branchId: optionalText(64),
  roleIds: roleIdsField,
  status: userStatusSchema,
  password: optionalText(200),
  confirmPassword: optionalText(200),
};

/**
 * The cross-field rules, applied to whichever object shape needs them.
 *
 * Defined as a function rather than chained once because `.superRefine` does not
 * survive `.extend()` — the employee schema extends this one, and a refinement
 * left on the base would silently stop running there. Re-applying it explicitly
 * is what keeps both forms enforcing the same rule.
 */
function withPasswordRules<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((value, ctx) => {
    const password = (value as { password?: string }).password;
    const confirmPassword = (value as { confirmPassword?: string })
      .confirmPassword;

    if (!password) {
      // Nothing to confirm. A stray confirmation on its own is not an error —
      // it just has no password to disagree with.
      return;
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      });
    }

    if (!confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Confirm the password",
      });
      return;
    }

    if (password !== confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
  });
}

export const createUserSchema = withPasswordRules(z.object(createUserFields));

/**
 * Administrator edit.
 *
 * Name and email only. Mobile is absent because it is the login identifier —
 * changing it is an identity change, not a profile edit, and Q-REC-21 leaves it
 * to a dedicated flow. Status, roles and branch each have their own endpoint.
 */
export const updateUserSchema = z.object({
  name: z.string().trim().min(1, "Full Name is required").max(200),
  email: optionalText(320).pipe(emailSchema.optional()),
});

/**
 * Employee create.
 *
 * Differs from the administrator form in exactly two ways, and both are required
 * rather than optional: an employee has a code (that is what makes the record an
 * employee) and belongs to a branch (Q-RBAC-6 — field work happens somewhere).
 */
export const createEmployeeSchema = withPasswordRules(
  z.object({
    ...createUserFields,
    employeeCode: employeeCodeSchema,
    branchId: idSchema.min(1, "Branch is required"),
  }),
);

export const updateEmployeeSchema = updateUserSchema;

/**
 * Employee reassignment.
 *
 * A reason is optional but captured, because Scenario 50 requires the audit
 * record show the old and new context — the branch change alone does not say
 * why, and a transfer is the kind of thing an auditor asks about later.
 */
export const assignEmployeeSchema = z.object({
  branchId: idSchema.min(1, "Branch is required"),
  reason: optionalText(500),
});

/** Account activation and deactivation, both directions through one schema. */
export const setUserStatusSchema = z.object({
  status: userStatusSchema,
  reason: optionalText(500),
});

export const assignRolesSchema = z.object({
  roleIds: roleIdsField,
});

/**
 * Role create.
 *
 * `permissions` may be empty: the source sequence is Create Role → Assign Module
 * Permissions → Save & Activate, so a role legitimately exists before it grants
 * anything. Activation is where a non-empty set becomes mandatory.
 */
export const createRoleSchema = z.object({
  code: roleCodeSchema,
  name: z.string().trim().min(1, "Role Name is required").max(150),
  description: optionalText(500),
  permissions: z.array(z.string().trim().min(1)).max(200),
});

/** Role edit. Code is absent — see `roleCodeSchema`. */
export const updateRoleSchema = z.object({
  name: z.string().trim().min(1, "Role Name is required").max(150),
  description: optionalText(500),
});

export const setRoleStatusSchema = z.object({
  status: roleStatusSchema,
  reason: optionalText(500),
});

/**
 * The role's permission set, as a full replacement.
 *
 * An empty array is valid and means "revoke all" — the alternative would be a
 * separate delete endpoint for the last permission, which is the same operation
 * wearing a different name.
 */
export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1)).max(200),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type AssignEmployeeInput = z.infer<typeof assignEmployeeSchema>;
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type SetRoleStatusInput = z.infer<typeof setRoleStatusSchema>;
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;
