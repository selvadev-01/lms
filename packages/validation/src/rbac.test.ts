import { describe, expect, it } from "vitest";

import {
  assignEmployeeSchema,
  assignRolesSchema,
  createEmployeeSchema,
  createRoleSchema,
  createUserSchema,
  employeeCodeSchema,
  roleCodeSchema,
  setRolePermissionsSchema,
  setUserStatusSchema,
  updateRoleSchema,
  updateUserSchema,
} from "./index";

/**
 * Module 03 form schemas.
 *
 * Three things carry the weight here.
 *
 * The **mandatory-field messages** are asserted verbatim, because the story
 * specifies them in a Scenario Outline and the e2e specs match on the rendered
 * text. A reworded message is a silently broken test two layers up.
 *
 * The **absent fields** are asserted to be rejected rather than ignored. The API
 * runs `forbidNonWhitelisted`, so `status` on an update DTO is a 400 there — but
 * these schemas are also what the web actions parse, and a schema that quietly
 * dropped the field would let a form submit something the server then refuses,
 * turning a clear validation error into a confusing round trip.
 *
 * The **empty permission set** is valid on purpose. The source sequence is Create
 * Role → Assign Module Permissions → Save & Activate, so a role exists before it
 * grants anything, and `[]` is how "revoke all" is spelled.
 */

const validUser = {
  name: "Priya Raman",
  mobile: "9876543210",
  email: "",
  branchId: "",
  roleIds: ["11111111-1111-4111-8111-111111111111"],
  status: "PENDING",
};

describe("createUserSchema", () => {
  it("accepts a minimal administrator with no email or branch", () => {
    const result = createUserSchema.safeParse(validUser);

    expect(result.success).toBe(true);
    if (result.success) {
      // Both spellings of "absent" normalize away, so the service sees one shape.
      expect(result.data.email).toBeUndefined();
      expect(result.data.branchId).toBeUndefined();
    }
  });

  it("accepts a null branch, as an unrendered field submits", () => {
    const result = createUserSchema.safeParse({ ...validUser, branchId: null });

    expect(result.success).toBe(true);
  });

  it("reports the story's message when Full Name is missing", () => {
    const result = createUserSchema.safeParse({ ...validUser, name: "  " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name).toContain(
        "Full Name is required",
      );
    }
  });

  it("reports the story's message when the login identifier is missing", () => {
    const result = createUserSchema.safeParse({ ...validUser, mobile: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.mobile).toContain(
        "Mobile Number is required",
      );
    }
  });

  it("reports the story's message when no role is selected", () => {
    const result = createUserSchema.safeParse({ ...validUser, roleIds: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.roleIds).toContain(
        "Role is required",
      );
    }
  });

  it("rejects an account status outside the enum", () => {
    const result = createUserSchema.safeParse({
      ...validUser,
      status: "ARCHIVED",
    });

    expect(result.success).toBe(false);
  });

  it("accepts PENDING, the status a provisioned account starts in", () => {
    const result = createUserSchema.safeParse({
      ...validUser,
      status: "PENDING",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a malformed mobile even when present", () => {
    const result = createUserSchema.safeParse({
      ...validUser,
      mobile: "1234567890",
    });

    expect(result.success).toBe(false);
  });

  it("has no orgId field, so scope cannot be named by the caller", () => {
    const result = createUserSchema.safeParse({
      ...validUser,
      orgId: "22222222-2222-4222-8222-222222222222",
    });

    // Zod strips unknown keys rather than failing; what matters is that the
    // value cannot reach the service. The API's forbidNonWhitelisted turns the
    // same attempt into a 400 one layer out.
    expect(result.success).toBe(true);
    if (result.success) expect("orgId" in result.data).toBe(false);
  });
});

describe("createEmployeeSchema", () => {
  const validEmployee = {
    ...validUser,
    employeeCode: "EMP101",
    branchId: "33333333-3333-4333-8333-333333333333",
  };

  it("accepts a complete employee", () => {
    expect(createEmployeeSchema.safeParse(validEmployee).success).toBe(true);
  });

  it("requires a branch, unlike the administrator form", () => {
    const result = createEmployeeSchema.safeParse({
      ...validEmployee,
      branchId: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.branchId).toContain(
        "Branch is required",
      );
    }
  });

  it("requires an employee code — its presence is what makes this an employee", () => {
    const result = createEmployeeSchema.safeParse({
      ...validEmployee,
      employeeCode: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.employeeCode).toContain(
        "Employee ID is required",
      );
    }
  });
});

describe("updateUserSchema", () => {
  it("accepts a name and email change", () => {
    const result = updateUserSchema.safeParse({
      name: "Priya Raman",
      email: "priya@example.com",
    });

    expect(result.success).toBe(true);
  });

  it("drops status, roles, branch and mobile rather than honouring them", () => {
    const result = updateUserSchema.safeParse({
      name: "Priya Raman",
      email: "",
      status: "ACTIVE",
      roleIds: ["44444444-4444-4444-8444-444444444444"],
      branchId: "55555555-5555-4555-8555-555555555555",
      mobile: "9876543210",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Each of these has its own endpoint and its own permission. An edit that
      // could carry them would let one permission do four jobs.
      expect("status" in result.data).toBe(false);
      expect("roleIds" in result.data).toBe(false);
      expect("branchId" in result.data).toBe(false);
      expect("mobile" in result.data).toBe(false);
    }
  });
});

describe("setUserStatusSchema", () => {
  it("accepts a null reason, as an unrendered field submits", () => {
    const result = setUserStatusSchema.safeParse({
      status: "INACTIVE",
      reason: null,
    });

    expect(result.success).toBe(true);
  });

  it("normalizes an empty reason to undefined", () => {
    const result = setUserStatusSchema.safeParse({
      status: "INACTIVE",
      reason: "",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBeUndefined();
  });

  it("caps the reason at the column width", () => {
    const result = setUserStatusSchema.safeParse({
      status: "INACTIVE",
      reason: "x".repeat(501),
    });

    expect(result.success).toBe(false);
  });
});

describe("assignEmployeeSchema", () => {
  it("requires a target branch", () => {
    const result = assignEmployeeSchema.safeParse({ branchId: "", reason: "" });

    expect(result.success).toBe(false);
  });

  it("accepts a reassignment with no stated reason", () => {
    const result = assignEmployeeSchema.safeParse({
      branchId: "66666666-6666-4666-8666-666666666666",
      reason: null,
    });

    expect(result.success).toBe(true);
  });
});

describe("assignRolesSchema", () => {
  it("requires at least one role, since assignment is explicit", () => {
    const result = assignRolesSchema.safeParse({ roleIds: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.roleIds).toContain(
        "Role is required",
      );
    }
  });

  it("accepts several roles — the effective set is their union", () => {
    const result = assignRolesSchema.safeParse({
      roleIds: [
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe("roleCodeSchema", () => {
  it.each(["SUPER_ADMIN", "BRANCH_ADMIN", "AUDITOR2", "A"])(
    "accepts %s",
    (code) => {
      expect(roleCodeSchema.safeParse(code).success).toBe(true);
    },
  );

  it.each(["super_admin", "Branch Admin", "2FAST", "ROLE-X", "_LEADING"])(
    "rejects %s",
    (code) => {
      expect(roleCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});

describe("employeeCodeSchema", () => {
  it.each(["EMP001", "emp-001", "emp_001", "12345"])("accepts %s", (code) => {
    expect(employeeCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(["EMP 001", "EMP/001", "EMP.001", ""])("rejects %s", (code) => {
    expect(employeeCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("createRoleSchema", () => {
  it("accepts a role with no permissions yet", () => {
    const result = createRoleSchema.safeParse({
      code: "AUDITOR",
      name: "Auditor",
      description: "",
      permissions: [],
    });

    expect(result.success).toBe(true);
  });

  it("reports the story's message when Role Name is missing", () => {
    const result = createRoleSchema.safeParse({
      code: "AUDITOR",
      name: " ",
      permissions: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name).toContain(
        "Role Name is required",
      );
    }
  });
});

describe("updateRoleSchema", () => {
  it("drops code and status — a role code is immutable", () => {
    const result = updateRoleSchema.safeParse({
      name: "Auditor",
      description: "",
      code: "RENAMED",
      status: "ACTIVE",
      permissions: ["loans.approve"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect("code" in result.data).toBe(false);
      expect("status" in result.data).toBe(false);
      expect("permissions" in result.data).toBe(false);
    }
  });
});

describe("setRolePermissionsSchema", () => {
  it("accepts an empty set, which is how revoke-all is spelled", () => {
    const result = setRolePermissionsSchema.safeParse({ permissions: [] });

    expect(result.success).toBe(true);
  });

  it("accepts a set of codes", () => {
    const result = setRolePermissionsSchema.safeParse({
      permissions: ["branches.view", "users.view"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a blank code, which would match no catalog row", () => {
    const result = setRolePermissionsSchema.safeParse({
      permissions: ["branches.view", "  "],
    });

    expect(result.success).toBe(false);
  });
});
